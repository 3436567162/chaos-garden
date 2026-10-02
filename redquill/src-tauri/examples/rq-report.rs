// Re-derive the defence report from a stored run and print it.
//
// Separate from `rq-scan` on purpose: report logic changes constantly, the raw
// responses do not. Re-deriving from the archive verifies a report fix without
// spending anything or waiting on a live model, and against exactly the data the
// original run saw.
//
//   cargo run --release --example rq-report -- --run latest
//   cargo run --release --example rq-report -- --run <runId> --compare-to <otherRunId>

use redquill_lib::advice;
use redquill_lib::model::ScanResult;

fn main() {
    let mut run_id = String::new();
    let mut compare_to = String::new();
    let raw: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < raw.len() {
        match raw[i].as_str() {
            "--run" => run_id = raw.get(i + 1).cloned().unwrap_or_default(),
            "--compare-to" => compare_to = raw.get(i + 1).cloned().unwrap_or_default(),
            other => {
                eprintln!("error: unknown flag {other}");
                std::process::exit(1);
            }
        }
        i += 2;
    }
    if run_id.is_empty() {
        eprintln!("error: --run <runId|latest> is required");
        std::process::exit(1);
    }
    if run_id == "latest" {
        match redquill_lib::store::list().first() {
            Some(s) => run_id = s.run_id.clone(),
            None => {
                eprintln!("error: no stored runs");
                std::process::exit(1);
            }
        }
    }

    let result = match redquill_lib::store::load(&run_id) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(1);
        }
    };

    print_report(&result);

    if !compare_to.is_empty() {
        let before = match redquill_lib::store::load(&compare_to) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("error loading {compare_to}: {e}");
                std::process::exit(1);
            }
        };
        print_diff(&before, &result);
    }
}

fn print_report(result: &ScanResult) {
    let derived = advice::derive(&result.attempts, &result.expected_breaks);
    let rank = |s: &str| match s {
        "critical" => 0,
        "high" => 1,
        "medium" => 2,
        _ => 3,
    };

    println!("\n{}", "=".repeat(78));
    println!(
        "run {} · target {} · {} attempts · {} confirmed breaks ({:.0}%)",
        result.run_id,
        result.target_model,
        result.total_attempts,
        result.total_breaks,
        result.overall_success_rate * 100.0
    );
    println!(
        "findings: {} total · {} critical · {} high · {} medium · {} low",
        derived.len(),
        derived.iter().filter(|f| f.severity == "critical").count(),
        derived.iter().filter(|f| f.severity == "high").count(),
        derived.iter().filter(|f| f.severity == "medium").count(),
        derived.iter().filter(|f| rank(&f.severity) == 3).count(),
    );
    println!("{}", "=".repeat(78));

    let mut sorted = derived.clone();
    sorted.sort_by_key(|f| rank(&f.severity));
    for (n, f) in sorted.iter().enumerate() {
        println!("\n{}. [{}] {}", n + 1, f.severity.to_uppercase(), f.title);
        for line in f.detail.lines() {
            println!("   {line}");
        }
        println!("   -> {}", f.recommendation);
        if !f.evidence.is_empty() {
            println!("   evidence: {}", f.evidence.join(", "));
        }
    }
    println!("\n{}\n", "=".repeat(78));
}

/// Side-by-side severity counts, for checking that a report change actually
/// reduced noise rather than just reshuffling it.
fn print_diff(before: &ScanResult, after: &ScanResult) {
    let counts = |r: &ScanResult| -> Vec<usize> {
        let d = advice::derive(&r.attempts, &r.expected_breaks);
        vec![
            d.iter().filter(|f| f.severity == "critical").count(),
            d.iter().filter(|f| f.severity == "high").count(),
            d.iter().filter(|f| f.severity == "medium").count(),
            d.iter().filter(|f| f.severity == "low").count(),
        ]
    };
    let b = counts(before);
    let a = counts(after);
    println!("report diff · {} -> {}", before.run_id, after.run_id);
    println!("{:<10} {:>6} {:>6} {:>8}", "severity", "before", "after", "delta");
    for (i, name) in ["critical", "high", "medium", "low"].iter().enumerate() {
        println!(
            "{:<10} {:>6} {:>6} {:>+8}",
            name,
            b[i],
            a[i],
            a[i] as i64 - b[i] as i64
        );
    }
    println!();
}