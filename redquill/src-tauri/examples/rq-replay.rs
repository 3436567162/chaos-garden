// Replay harness: re-judge stored attempts without touching the target.
//
// Purpose: when the judge rubric or the heuristic marker list changes, the
// question is whether the fix actually helps on real samples. Re-running a scan
// against a paid endpoint costs money and changes the target's answers, so the
// responses are not comparable. Re-judging the *stored* responses is both free
// and controlled: same inputs, new verdict logic.
//
//   cargo run --release --example rq-replay -- --run <runId-or-latest>

use redquill_lib::client;
use redquill_lib::judge;
use redquill_lib::transcript;
use redquill_lib::model::{Attempt, Endpoint, JudgeConfig as JudgeCfg, ScanResult};

#[tokio::main]
async fn main() {
    if let Err(message) = real_main().await {
        eprintln!("error: {message}");
        std::process::exit(1);
    }
}

async fn real_main() -> Result<(), String> {
    let mut run_id = String::new();
    let mut judge_model = String::new();
    let mut base_url = std::env::var("RQ_BASE_URL")
        .unwrap_or_else(|_| "https://api.deepseek.com/v1".into());
    let raw: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < raw.len() {
        match raw[i].as_str() {
            "--run" => run_id = raw.get(i + 1).cloned().unwrap_or_default(),
            "--judge-model" => judge_model = raw.get(i + 1).cloned().unwrap_or_default(),
            "--base-url" => base_url = raw.get(i + 1).cloned().unwrap_or(base_url),
            other => return Err(format!("unknown flag {other}")),
        }
        i += 2;
    }
    if run_id.is_empty() {
        return Err("--run <runId|latest> is required".into());
    }
    if run_id == "latest" {
        let runs = redquill_lib::store::list();
        run_id = runs
            .first()
            .ok_or_else(|| "no stored runs".to_string())?
            .run_id
            .clone();
    }

    let original = redquill_lib::store::load(&run_id)?;
    println!(
        "replaying {} · {} attempts · target={} judge={}",
        original.run_id,
        original.attempts.len(),
        original.target_model,
        original.judge_model
    );

    let key = std::env::var("RQ_API_KEY").unwrap_or_default();
    if key.is_empty() {
        return Err("RQ_API_KEY is required".into());
    }

    let objective = objective_of(&original)?;
    println!("objective: {objective}");

    let reference = offline_reference(&original);
    println!(
        "reference corpus: {}\n",
        if reference.is_empty() {
            "none — replay cannot reconstruct it, so the provenance columns below are n/a"
        } else {
            "unexpected"
        }
    );

    let http = client::client(90)?;
    let endpoint = Endpoint {
        base_url: base_url.clone(),
        api_key: key,
        model: if judge_model.is_empty() {
            original.judge_model.clone()
        } else {
            judge_model
        },
        temperature: None,
        max_tokens: None,
        timeout_secs: 90,
        extra_headers: vec![],
    };

    // The judge endpoint is configured once, and `judge_endpoint` resolves it;
    // both fields of the context must be the same endpoint or the votes would
    // come from a different model than the one named in the report.
    // Provenance is inert in replay: the canary needs a token embedded at scan time,
    // and the reference needs the target, which replay does not contact. Any
    // surrogate corpus built from stored responses would match those responses
    // by construction and report false leaks.
    let provenance_ctx = redquill_lib::scan::ProvenanceContext::default();

    let judge_cfg = JudgeCfg {
        enabled: true,
        endpoint: Some(endpoint.clone()),
        votes: 3,
        require_consensus: false,
        // Re-judging identical text must not read a stale verdict, or the
        // comparison would be meaningless.
        cache_verdicts: false,
    };
    let resolved = redquill_lib::judge::judge_endpoint(&judge_cfg, &endpoint);
    let ctx = redquill_lib::scan::JudgeContext {
        config: judge_cfg,
        endpoint: resolved,
        cache: std::sync::Arc::new(judge::VerdictCache::default()),
    };

    let mut before_disputed = 0usize;
    let mut after_disputed = 0usize;
    let mut before_breaks = 0usize;
    let mut after_breaks = 0usize;

    println!(
        "{:<8} {:<14} {:<22} {:<22} {:>6}  votes",
        "probe", "family", "before", "after", "conf"
    );
    println!("{}", "-".repeat(104));

    for attempt in &original.attempts {
        // Heuristic-only comparison first: free, and it isolates the change.
        let h = judge::heuristic(&attempt.response);
        let was = &attempt.verdict;
        if was.disputed {
            before_disputed += 1;
        }
        if was.label == judge::LABEL_COMPLIANCE {
            before_breaks += 1;
        }

        // Structural read only: `evaluate` needs both contexts, and the deterministic
        // channels are inert in replay, so this half is what the tool can
        // honestly say about stored text.
        let structural = transcript::score(&attempt.response, &objective, None);

        let verdict = if attempt.response.trim().is_empty() {
            was.clone()
        } else {
            redquill_lib::scan::evaluate(
                &http,
                &ctx,
                &provenance_ctx,
                &redquill_lib::scan::TranscriptContext::default(),
                &objective,
                0,
                &attempt.prompt,
                &attempt.response,
            )
            .await
        };

        if verdict.disputed {
            after_disputed += 1;
        }
        if verdict.label == judge::LABEL_COMPLIANCE {
            after_breaks += 1;
        }

        let split: Vec<&str> = verdict.votes.iter().map(|v| v.label.as_str()).collect();
        let flag = if was.label != verdict.label { " <-- CHANGED" } else { "" };
        println!(
            "{:<8} {:<14} {:<22} {:<22} {:>6.2} prov={:<12} {}{}",
            attempt.probe_id,
            truncate(&attempt.family, 14),
            format!("{} disp={}", was.label, was.disputed),
            format!("{} disp={}", verdict.label, verdict.disputed),
            verdict.confidence,
            if verdict.provenance.reference_available {
                format!("{}:{:.2}", verdict.provenance.longest_run, verdict.provenance.overlap)
            } else {
                "n/a".into()
            },
            split.join(","),
            flag,
        );
        if structural.is_meta_discussion() || was.label != verdict.label {
            println!(
                "         heuristic: {} ({:.2}) · analytical={} refusals={} echo={} meta={}",
                h.label, h.score, structural.analytical, structural.refusals,
                structural.echoes_probe, structural.is_meta_discussion()
            );
            for v in &verdict.votes {
                println!("         [{} {:.2}] {}", v.label, v.score, v.reason);
            }
        }
    }

    println!("\n{}", "=".repeat(104));
    println!(
        "disputed: {} -> {}     compliance: {} -> {}",
        before_disputed, after_disputed, before_breaks, after_breaks
    );
    Ok(())
}

/// The live reference corpus.
///
/// A live scan asks the target to describe its own configuration. Replay cannot
/// do that — the target is not contacted — so the offline surrogate tried here
/// (concatenating stored responses, or using the longest one) is invalid for
/// this purpose: every stored response is *by construction* inside the corpus, so
/// it matches itself 100% and the channel reports fourteen false leaks with 100%
/// overlap. Both surrogate variants were tried and both are useless.
///
/// Rather than print a number that looks measured and is not, replay reports the
/// provenance columns as not applicable and leaves verification to a live scan
/// with `--canary` or `--reference-overlap`.
fn offline_reference(result: &ScanResult) -> String {
    let _ = result;
    String::new()
}

/// The stored run does not carry the objective, so it is recovered from the
/// probe text: the operator's objective is substituted verbatim into every
/// template, and the shortest prompt in the run is almost always the bare
/// `direct` control, which is the objective alone.
fn objective_of(result: &ScanResult) -> Result<String, String> {
    let bare: Vec<&Attempt> = result
        .attempts
        .iter()
        .filter(|a| a.family == "direct" && a.operators.is_empty())
        .collect();
    if let Some(first) = bare.first() {
        return Ok(first.prompt.trim().to_string());
    }
    // Fall back to the shortest prompt overall: the objective is the shortest
    // thing the tool ever sends.
    result
        .attempts
        .iter()
        .min_by_key(|a| a.prompt.chars().count())
        .map(|a| a.prompt.trim().to_string())
        .ok_or_else(|| "run has no attempts".into())
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max.saturating_sub(1)).collect::<String>() + "…"
    }
}