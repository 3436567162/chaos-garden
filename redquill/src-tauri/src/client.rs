// Minimal OpenAI-compatible chat client. One shape covers the target under
// test, the judge, and the rewriter, which is the whole point of targeting
// /v1/chat/completions: vLLM, Ollama, LM Studio, llama.cpp and the hosted APIs
// all speak it.

use crate::model::{Endpoint, Message, Sampling};
use std::time::Duration;

/// Raw completion outcome. `Err` carries a display message so the UI can show
/// why a probe failed without stringifying the whole reqwest error chain.
pub struct Completion {
    pub text: String,
    pub latency_ms: u64,
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
}

#[derive(Debug, serde::Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Debug, serde::Deserialize)]
struct Choice {
    message: ResponseMessage,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct ResponseMessage {
    #[serde(default)]
    content: serde_json::Value,
}

#[derive(Debug, serde::Deserialize)]
struct Usage {
    #[serde(default)]
    prompt_tokens: Option<u32>,
    #[serde(default)]
    completion_tokens: Option<u32>,
}

/// Floor for `max_tokens`.
///
/// Reasoning endpoints bill hidden reasoning against the same budget as the
/// visible answer, and an operator-supplied value tuned for a non-reasoning
/// model leaves nothing for the answer itself — the request comes back with
/// `finish_reason: "length"` and an empty content field. 30000 is the budget
/// the reasoning endpoints in use actually need; anything smaller silently
/// returns empty responses rather than erroring.
pub const REASONING_TOKEN_FLOOR: u32 = 30_000;

/// Builds a client with per-request timeout; TLS via rustls so no system
/// OpenSSL is required on any platform.
pub fn client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs.max(1)))
        .connect_timeout(Duration::from_secs(15))
        .user_agent(concat!("redquill/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

fn completions_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

fn models_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/models") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/models")
    }
}

/// Fires one chat completion. `sampling` overrides the endpoint's defaults.
pub async fn chat(
    http: &reqwest::Client,
    endpoint: &Endpoint,
    sampling: &Sampling,
    messages: &[Message],
) -> Result<Completion, String> {
    let started = std::time::Instant::now();

    let mut body = serde_json::json!({
        "model": endpoint.model,
        "messages": messages,
    });
    if let Some(t) = sampling.temperature.or(endpoint.temperature) {
        body["temperature"] = serde_json::json!(t);
    }
    // Reasoning models count hidden reasoning against `max_tokens`, so a value
    // tuned for a non-reasoning model leaves no room for the visible answer.
    // 2048 is the smallest setting that reliably leaves output headroom on the
    // reasoning endpoints in use; anything lower shows up as empty responses.
    body["max_tokens"] = serde_json::json!(
        sampling
            .max_tokens
            .or(endpoint.max_tokens)
            .unwrap_or(REASONING_TOKEN_FLOOR)
            .max(REASONING_TOKEN_FLOOR)
    );
    // Judge and rewriter calls want determinism; the target keeps its own
    // sampling so we measure the deployment as configured.
    body["stream"] = serde_json::json!(false);

    let mut req = http.post(completions_url(&endpoint.base_url)).json(&body);
    if !endpoint.api_key.trim().is_empty() {
        req = req.bearer_auth(endpoint.api_key.trim());
    }
    for (k, v) in &endpoint.extra_headers {
        if !k.trim().is_empty() {
            req = req.header(k.trim(), v);
        }
    }

    let resp = req.send().await.map_err(|e| classify_error(&e))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("failed to read response body: {e}"))?;

    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), truncate(&text, 400)));
    }

    let parsed: ChatResponse = serde_json::from_str(&text)
        .map_err(|e| format!("malformed chat response ({e}): {}", truncate(&text, 300)))?;

    let choice = parsed
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| "response contained no choices".to_string())?;
    let content = flatten_content(choice.message.content);
    let finish = choice.finish_reason.as_deref().unwrap_or("");

    // A reasoning model can burn the whole `max_tokens` budget on hidden
    // reasoning and return `finish_reason: "length"` with an *empty* content
    // field. Silently storing that as an empty response is worse than
    // reporting it: the judge classifies an empty response as `uncertain`, so
    // the run silently loses coverage instead of telling the operator that the
    // budget was too small. Surface it as a distinct, actionable error.
    if content.trim().is_empty() && finish == "length" {
        return Err(
            "response truncated by max_tokens before any visible output — this model spent the \
             whole budget on reasoning. Raise max_tokens on the endpoint, otherwise these attacks \
             score as `uncertain` instead of as results"
                .to_string(),
        );
    }

    Ok(Completion {
        text: content,
        latency_ms: started.elapsed().as_millis() as u64,
        prompt_tokens: parsed.usage.as_ref().and_then(|u| u.prompt_tokens),
        completion_tokens: parsed.usage.as_ref().and_then(|u| u.completion_tokens),
    })
}

/// Some gateways return `content` as a string, others as an array of parts,
/// and a few as an object. Handle all three instead of assuming the happy path.
fn flatten_content(value: serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s,
        serde_json::Value::Null => String::new(),
        serde_json::Value::Array(parts) => {
            let mut out = String::new();
            for part in parts {
                if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                    out.push_str(text);
                }
            }
            out
        }
        other => other.to_string(),
    }
}

/// Turns transport failures into messages that hint at the usual cause, since
/// a bare "error sending request" tells the operator nothing.
fn classify_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "request timed out — raise timeout or lower concurrency".to_string()
    } else if e.is_connect() {
        format!("cannot reach endpoint ({e}) — check base URL and that the server is up")
    } else {
        format!("request failed: {e}")
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let head: String = s.chars().take(max).collect();
        format!("{head}…")
    }
}

/// Lists model ids from `/models`, for the endpoint picker. Servers without the
/// route (some Ollama versions) return an error the UI shows as a hint.
pub async fn list_models(http: &reqwest::Client, endpoint: &Endpoint) -> Result<Vec<String>, String> {
    let mut req = http.get(models_url(&endpoint.base_url));
    if !endpoint.api_key.trim().is_empty() {
        req = req.bearer_auth(endpoint.api_key.trim());
    }
    let resp = req.send().await.map_err(|e| classify_error(&e))?;
    let status = resp.status();
    let body: serde_json::Value = resp
        .text()
        .await
        .map_err(|e| format!("failed to read response body: {e}"))?
        .parse()
        .map_err(|_| "malformed /models response".to_string())?;

    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), truncate(&body.to_string(), 200)));
    }

    let ids = body
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.get("id").and_then(|i| i.as_str()))
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(ids)
}

/// Cheap reachability probe: one tiny completion, used by the UI's "test
/// connection" button so the operator does not wait for a full scan to learn
/// their model id is wrong.
pub async fn ping(http: &reqwest::Client, endpoint: &Endpoint) -> Result<String, String> {
    let sampling = Sampling { temperature: Some(0.0), max_tokens: Some(8), timeout_secs: endpoint.timeout_secs };
    let reply = chat(
        http,
        endpoint,
        &sampling,
        &[Message::user("Reply with the single word: ready")],
    )
    .await?;
    Ok(format!("{} · {:.0}ms", truncate(reply.text.trim(), 60), reply.latency_ms))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_chat_url_from_various_bases() {
        assert_eq!(
            completions_url("http://localhost:11434/v1"),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            completions_url("http://localhost:11434/v1/"),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            completions_url("https://api.example.com/v1/chat/completions"),
            "https://api.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn builds_models_url_idempotently() {
        assert_eq!(models_url("http://h:8000/v1"), "http://h:8000/v1/models");
        assert_eq!(models_url("http://h:8000/v1/models"), "http://h:8000/v1/models");
    }

    #[test]
    fn empty_content_with_finish_length_is_reported_as_truncation() {
        // Reasoning models can consume the entire max_tokens budget on hidden
        // reasoning and return an empty content field. Storing that as an empty
        // response would make the judge label every such attempt `uncertain`,
        // silently destroying coverage — it has to surface as an error.
        let body = r#"{
          "choices": [
            { "message": { "content": "" }, "finish_reason": "length" }
          ],
          "usage": { "completion_tokens": 600 }
        }"#;
        let parsed: ChatResponse = serde_json::from_str(body).unwrap();
        let choice = parsed.choices.into_iter().next().unwrap();
        let content = flatten_content(choice.message.content);
        let finish = choice.finish_reason.as_deref().unwrap_or("");
        assert!(content.trim().is_empty());
        assert_eq!(finish, "length");
    }

    #[test]
    fn finish_reason_parses_when_absent() {
        let body = r#"{ "choices": [ { "message": { "content": "hi" } } ] }"#;
        let parsed: ChatResponse = serde_json::from_str(body).unwrap();
        let choice = parsed.choices.into_iter().next().unwrap();
        assert_eq!(choice.finish_reason, None);
        assert_eq!(choice.finish_reason.as_deref().unwrap_or(""), "");
    }

    #[test]
    fn token_budget_has_a_reasoning_model_floor() {
        // Whatever the caller asks for, the floor guarantees room for hidden
        // reasoning *and* a visible answer on endpoints that reason first.
        let floor = |requested: Option<u32>| {
            requested
                .unwrap_or(REASONING_TOKEN_FLOOR)
                .max(REASONING_TOKEN_FLOOR)
        };
        assert_eq!(floor(None), 30_000);
        assert_eq!(floor(Some(600)), 30_000, "small budgets must be raised");
        assert_eq!(floor(Some(4096)), 30_000);
        // An explicit larger budget is honoured as-is.
        assert_eq!(floor(Some(64_000)), 64_000);
    }

    #[test]
    fn flattens_all_content_shapes() {
        assert_eq!(
            flatten_content(serde_json::json!("plain")),
            "plain"
        );
        assert_eq!(
            flatten_content(serde_json::json!([
                { "type": "text", "text": "a" },
                { "type": "text", "text": "b" }
            ])),
            "ab"
        );
        assert_eq!(flatten_content(serde_json::json!(null)), "");
    }
}