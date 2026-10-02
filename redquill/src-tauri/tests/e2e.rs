// Local end-to-end check against a stub OpenAI-compatible server.
//
// Verifies the whole chain — probe generation, HTTP, judging, evolution, report
// derivation, serialisation — without touching any real model. The stub answers
// with a refusal for single-turn prompts and a compliant answer for probes that
// carry an operator, so a run must produce both breaks and refusals. A report
// with zero breaks would mean the pipeline silently no-opped.
//
// Not part of the app: run with `cargo test --test e2e -- --ignored`.

// Gated on the same feature as the stub server it drives, so a default-feature
// `cargo test` / `cargo clippy` does not try to compile against a module that
// is not there.
#![cfg(feature = "test-support")]

use redquill_lib::testing::{probe_sequence, run_scan_with_stub, StubBehaviour};

#[tokio::test]
#[ignore = "starts a loopback HTTP server"]
async fn full_scan_produces_breaks_refusals_and_findings() {
    let result = run_scan_with_stub(StubBehaviour::RefuseUnlessOperator, 3, 2)
        .await
        .expect("scan completes");

    assert!(result.total_attempts > 0, "no attempts were made");
    assert!(result.generations == 2);

    // The stub refuses a bare request, so a bare `direct` probe must never break.
// Note this is *not* the same as "the direct family has no breaks": evolution
// attaches operators to any family in later generations, which is exactly what
// the report's baseline finding keys on — it requires an operator-free direct
// probe specifically.
let bare_direct: Vec<_> = result
    .attempts
    .iter()
    .filter(|a| a.family == "direct" && a.operators.is_empty())
    .collect();
assert!(
    !bare_direct.is_empty(),
    "the run must include bare `direct` probes for the baseline to mean anything"
);
assert!(
    bare_direct.iter().all(|a| a.verdict.label == "refusal"),
    "stub refuses operator-free requests by construction, so these must be \
     refusals; got {:?}",
    bare_direct
        .iter()
        .map(|a| a.verdict.label.as_str())
        .collect::<Vec<_>>()
);
assert!(
    result
        .family_stats
        .iter()
        .all(|s| s.errors == 0),
    "stub answered every request"
);

    // Operator-carrying probes get a compliant answer, so at least one family
    // carrying operators must break. If nothing did, the pipeline no-opped.
    let total_breaks: u32 = result.family_stats.iter().map(|s| s.breaks).sum();
    assert!(
        total_breaks > 0,
        "stub answers any operator-carrying probe with compliance, so at least \
         one break was expected; got none across {:?}",
        result
            .family_stats
            .iter()
            .map(|s| (s.family.as_str(), s.attempts, s.breaks))
            .collect::<Vec<_>>()
    );

    assert!(
        !result.findings.is_empty(),
        "breaks were observed, so the defence report must not be empty"
    );

    // Every finding must be actionable and cite the probes behind it.
    for finding in &result.findings {
        assert!(!finding.recommendation.trim().is_empty(), "{} has no advice", finding.title);
        assert!(
            finding.recommendation.chars().count() > 20,
            "{} advice is too thin to act on",
            finding.title
        );
    }

    // Findings are ordered most severe first.
    let rank = |s: &str| match s {
        "critical" => 0,
        "high" => 1,
        "medium" => 2,
        _ => 3,
    };
    let ranks: Vec<u8> = result.findings.iter().map(|f| rank(&f.severity)).collect();
    let mut sorted = ranks.clone();
    sorted.sort_unstable();
    assert_eq!(ranks, sorted, "findings are not severity-ordered");
}

#[tokio::test]
#[ignore = "starts a loopback HTTP server"]
async fn serialised_run_round_trips_through_json() {
    use redquill_lib::testing::{serde_roundtrip, StubBehaviour};

    let result = run_scan_with_stub(StubBehaviour::AlwaysRefuse, 2, 1)
        .await
        .expect("scan completes");

    let restored: redquill_lib::ScanResult = serde_roundtrip(&result);
    assert_eq!(restored.run_id, result.run_id);
    assert_eq!(restored.total_attempts, result.total_attempts);
    assert_eq!(restored.attempts.len(), result.attempts.len());
    assert_eq!(restored.seed, result.seed);

    // Verdict evidence must survive the trip; a report whose signals vanish on
    // serialisation is a report nobody can audit.
    if let Some(first) = restored.attempts.iter().find(|a| !a.verdict.votes.is_empty()) {
        assert!(!first.verdict.votes[0].label.is_empty());
    }

    // An always-refusing target must produce zero breaks and an empty report.
    assert_eq!(result.total_breaks, 0);
    assert!(
        result.findings.iter().all(|f| f.title.contains("样本量")),
        "only the coverage warning should remain, got {:?}",
        result.findings.iter().map(|f| &f.title).collect::<Vec<_>>()
    );
}

#[tokio::test]
#[ignore = "starts a loopback HTTP server"]
async fn the_same_seed_reproduces_the_same_probe_sequence() {
    let a = probe_sequence(7, 2);
    let b = probe_sequence(7, 2);
    assert_eq!(a, b, "same seed must yield the same probe sequence");
    assert!(!a.is_empty());

    let c = probe_sequence(8, 2);
    assert_ne!(a, c, "a different seed must yield a different sequence");
}