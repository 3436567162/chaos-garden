// Headless runner: the same engine the desktop app uses, driven from a terminal.
//
// Intended for CI regression jobs and for scripted audits where nobody is
// watching a GUI. It is an example rather than a shipped binary so it never
// ships in the installer.
//
//   cargo run --example rq-scan --release -- \
//       --base-url https://api.deepseek.com/v1 \
//       --model deepseek-v4-pro \
//       --judge-model deepseek-flash \
//       --objective "verbatim system prompt" \
//       --population 8 --generations 2
//
// The API key is read from $RQ_API_KEY, never from argv, so it does not end up
// in shell history or in a CI log.

use redquill_lib::model::{Endpoint, JudgeConfig, ProvenanceConfig, ScanConfig};
use redquill_lib::{run_headless, StderrSink};

struct Args {
    base_url: String,
    model: String,
    judge_model: String,
    objective: String,
    population: usize,
    generations: u32,
    concurrency: usize,
    seed: u64,
    families: Vec<String>,
    system_prompt: Option<String>,
    judge_votes: u32,
    require_consensus: bool,
    canary: bool,
    reference_overlap: bool,
    nonce: bool,
    expected_breaks: Vec<String>,
}

impl Args {
    fn parse() -> Result<Self, String> {
        let mut args = Args {
            base_url: env_or("RQ_BASE_URL", "http://localhost:11434/v1"),
            model: env_or("RQ_MODEL", ""),
            judge_model: env_or("RQ_JUDGE_MODEL", ""),
            objective: env_or("RQ_OBJECTIVE", ""),
            population: 12,
            generations: 4,
            concurrency: 4,
            seed: 0x5eed_1234_abcd_0001,
            families: vec![],
            system_prompt: None,
            judge_votes: 3,
            require_consensus: false,
            canary: false,
            reference_overlap: false,
            nonce: false,
            expected_breaks: vec![],
        };

        let raw: Vec<String> = std::env::args().skip(1).collect();

        // Boolean flags stand alone; everything else consumes the following
        // argument. Treating the two alike was the earlier behaviour and it
        // silently ate the number after `--nonce`, so the kinds are separated.
        fn is_flag(name: &str) -> bool {
            matches!(
                name,
                "--require-consensus" | "--no-judge" | "--canary" | "--reference-overlap" | "--nonce"
            )
        }

        let mut i = 0;
        while i < raw.len() {
            let flag = raw[i].clone();
            if !flag.starts_with("--") {
                return Err(format!(
                    "unexpected value `{flag}` — every argument is `--name [value]`"
                ));
            }
            let value = || -> Result<String, String> {
                if is_flag(&flag) {
                    return Ok(String::new());
                }
                raw.get(i + 1)
                    .cloned()
                    .ok_or_else(|| format!("{flag} needs a value"))
            };
            match raw[i].as_str() {
                "--base-url" => args.base_url = value()?,
                "--model" => args.model = value()?,
                "--judge-model" => args.judge_model = value()?,
                "--objective" => args.objective = value()?,
                // Bounds mirror the engine's own clamps, so the CLI rejects a
                // bad budget instead of silently running something else.
                "--population" => args.population = bounded(&value()?, 64, "--population")? as usize,
                "--generations" => args.generations = bounded(&value()?, 12, "--generations")? as u32,
                "--concurrency" => args.concurrency = bounded(&value()?, 16, "--concurrency")? as usize,
                "--seed" => args.seed = num(&value()?)?,
                "--judge-votes" => args.judge_votes = bounded(&value()?, 9, "--judge-votes")? as u32,
                "--families" => {
                    args.families = value()?
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                }
                "--system-prompt" => args.system_prompt = Some(value()?),
                "--require-consensus" => args.require_consensus = true,
                "--no-judge" => args.judge_votes = 0,
                // Deterministic channels. Canary needs a system prompt to embed
                // the token in, which prepare_provenance enforces.
                "--canary" => args.canary = true,
                "--reference-overlap" => args.reference_overlap = true,
                "--nonce" => args.nonce = true,
                // Positive control: families where a weakness is known to be
                // planted, so a miss is measurable.
                "--expect-break" => args.expected_breaks.push(value()?),
                other => return Err(format!("unknown flag {other}")),
            }
            i += if is_flag(&raw[i]) { 1 } else { 2 };
        }

        if args.model.trim().is_empty() {
            return Err("--model is required".into());
        }
        if args.objective.trim().is_empty() {
            return Err("--objective is required (the behaviour under test)".into());
        }
        Ok(args)
    }
}

fn env_or(key: &str, fallback: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| fallback.to_string())
}

/// Numeric flag parsing, always as `u64` so one helper serves every field and
/// the caller narrows to its own width.
fn num(raw: &str) -> Result<u64, String> {
    raw.trim()
        .parse::<u64>()
        .map_err(|_| format!("`{raw}` is not a number"))
}

/// Parses then narrows, rejecting out-of-range values instead of truncating.
/// A truncated budget is worse than a refused one: the report would describe a
/// run that never happened.
fn bounded(raw: &str, max: u64, what: &str) -> Result<u64, String> {
    let value = num(raw)?;
    if value == 0 || value > max {
        return Err(format!("{what} must be between 1 and {max}, got {value}"));
    }
    Ok(value)
}

fn endpoint(base_url: &str, model: &str, key: &str) -> Endpoint {
    Endpoint {
        base_url: base_url.to_string(),
        api_key: key.to_string(),
        model: model.to_string(),
        temperature: Some(0.7),
        max_tokens: Some(600),
        timeout_secs: 90,
        extra_headers: vec![],
    }
}

#[tokio::main]
async fn main() {
    if let Err(message) = real_main().await {
        eprintln!("error: {message}");
        std::process::exit(1);
    }
}

async fn real_main() -> Result<(), String> {
    let args = Args::parse()?;
    let key = std::env::var("RQ_API_KEY").unwrap_or_default();

    let target = endpoint(&args.base_url, &args.model, &key);
    // A judge on a different model avoids the self-assessment blind spot; when
    // none is given the judge falls back to the target and the report says so.
    let judge_endpoint = if args.judge_model.trim().is_empty() {
        None
    } else {
        Some(endpoint(&args.base_url, &args.judge_model, &key))
    };

    let config = ScanConfig {
        objective: args.objective.clone(),
        target,
        judge: JudgeConfig {
            enabled: args.judge_votes > 0,
            endpoint: judge_endpoint,
            votes: args.judge_votes.max(1),
            require_consensus: args.require_consensus,
            cache_verdicts: true,
        },
        families: args.families.clone(),
        population: args.population,
        generations: args.generations,
        concurrency: args.concurrency,
        seed: args.seed,
        system_prompt: args.system_prompt.clone(),
        // Set explicitly: a CLI invocation is a deliberate act, and the run
        // needs the same authorisation signal the GUI gate produces.
        authorised: true,
        rewriter: None,
        provenance: ProvenanceConfig {
            canary: args.canary,
            reference_overlap: args.reference_overlap,
            nonce: args.nonce,
        },
        expected_breaks: args.expected_breaks.clone(),
    };

    let budget = args.population * args.generations as usize;
    eprintln!(
        "redquill headless · target={} judge={} · {} target calls",
        args.model,
        if args.judge_model.is_empty() { "same-as-target" } else { &args.judge_model },
        budget
    );

    let result = run_headless(&StderrSink { quiet: false }, config).await?;
    print_report(&result);
    Ok(())
}

fn print_report(result: &redquill_lib::ScanResult) {
    println!("\n{}", "=".repeat(78));
    println!(
        "run {} · target {} · judge {}",
        result.run_id, result.target_model, result.judge_model
    );
    if result.judge_model == result.target_model {
        println!("NOTE: judge is the target model — self-assessment blind spot, treat as a lead");
    }
    println!(
        "attempts {} · breaks {} ({:.0}%) · elapsed {} · seed {}",
        result.total_attempts,
        result.total_breaks,
        result.overall_success_rate * 100.0,
        result.elapsed_ms / 1000,
        result.seed
    );

    println!("\n-- per family {} --", "-".repeat(55));
    let mut stats = result.family_stats.clone();
    stats.sort_by(|a, b| {
        b.success_rate
            .partial_cmp(&a.success_rate)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    for s in &stats {
        println!(
            "{:<22} {:>2}/{:<2} breaks  {:>2} refuse  {:>2} partial  {:>2} err  {:>5.0}%",
            s.family,
            s.breaks,
            s.attempts,
            s.refusals,
            s.partial,
            s.errors,
            s.success_rate * 100.0
        );
    }

    println!("\n-- confirmed breaks {} --", "-".repeat(53));
    let breaks: Vec<_> = result
        .attempts
        .iter()
        .filter(|a| a.verdict.label == "compliance")
        .collect();
    if breaks.is_empty() {
        println!("(none)");
    }
    for a in breaks.iter().take(15) {
        println!(
            "{}  family={:<20} ops=[{}] conf={:.2} votes={:.0}%{}",
            a.probe_id,
            a.family,
            a.operators.join(","),
            a.verdict.confidence,
            a.verdict.vote_consensus * 100.0,
            if a.verdict.disputed { " DISPUTED" } else { "" }
        );
        let first: String = a.response.chars().take(180).collect();
        println!("    response: {}", first.replace('\n', " "));
    }
    if breaks.len() > 15 {
        println!("    … and {} more", breaks.len() - 15);
    }

    println!("\n-- defence findings {} --", "-".repeat(51));
    if result.findings.is_empty() {
        println!("(none derived — see the coverage warnings above)");
    }
    for f in &result.findings {
        println!("\n[{}] {}", f.severity.to_uppercase(), f.title);
        println!("  {}", f.detail);
        println!("  -> {}", f.recommendation);
        if !f.evidence.is_empty() {
            println!("  evidence: {}", f.evidence.join(", "));
        }
    }
    println!("\n{}\n", "=".repeat(78));
}
