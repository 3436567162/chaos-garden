// Run history on disk.
//
// Deliberately file-per-run JSON rather than SQLite. History here is
// append-only and read whole for the list view; a database would add a
// dependency and a migration story for no query the app actually makes. Each
// file is one complete, portable record — which is also what makes a run
// shareable as an artefact.

use crate::model::{RunSummary, ScanResult};
use std::path::{Path, PathBuf};

fn history_dir() -> Result<PathBuf, String> {
let base = dirs::config_dir()
        .or_else(dirs::data_local_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("redquill").join("runs");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn summary_of(result: &ScanResult) -> RunSummary {
    RunSummary {
        run_id: result.run_id.clone(),
        started_at: result.started_at.clone(),
        finished_at: result.finished_at.clone(),
        target_model: result.target_model.clone(),
        total_attempts: result.total_attempts,
        total_breaks: result.total_breaks,
        overall_success_rate: result.overall_success_rate,
        seed: result.seed,
    }
}

/// Persists a finished run. Failures are non-fatal: the scan result is still
/// valid in memory, and losing history should never lose a result.
pub fn save(result: &ScanResult) -> Result<(), String> {
    let dir = history_dir()?;
    let path = dir.join(format!("{}.json", sanitise(&result.run_id)));
    let body = serde_json::to_vec_pretty(result)
        .map_err(|e| format!("cannot serialise run: {e}"))?;
    std::fs::write(&path, body).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    prune(&dir, 200)
}

pub fn list() -> Vec<RunSummary> {
    let Ok(dir) = history_dir() else {
        return Vec::new();
    };
    let mut out: Vec<RunSummary> = Vec::new();
    for entry in read_dir_sorted(&dir) {
        let stem = entry
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if stem.is_empty() {
            continue;
        }
        // Run ids are sanitised on write, so the stem round-trips back through
        // `load`'s own sanitiser without changing.
        if let Ok(result) = load(&stem) {
            out.push(summary_of(&result));
        }
    }
    out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    out
}

pub fn load(run_id: &str) -> Result<ScanResult, String> {
    let dir = history_dir()?;
    let path = dir.join(format!("{}.json", sanitise(run_id)));
    let body = std::fs::read(&path)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    serde_json::from_slice(&body).map_err(|e| format!("corrupt run record {run_id}: {e}"))
}

pub fn remove(run_id: &str) -> Result<(), String> {
    let dir = history_dir()?;
    let path = dir.join(format!("{}.json", sanitise(run_id)));
    std::fs::remove_file(&path).map_err(|e| format!("cannot delete {run_id}: {e}"))
}

/// Exports a run to an arbitrary path so a finding can leave the app.
pub fn export(run_id: &str, destination: &Path) -> Result<(), String> {
    let result = load(run_id)?;
    let body = serde_json::to_vec_pretty(&result)
        .map_err(|e| format!("cannot serialise run: {e}"))?;
    std::fs::write(destination, body)
        .map_err(|e| format!("cannot write {}: {e}", destination.display()))
}

/// Run ids come from timestamps and model names, but they still land in a file
/// path, so anything path-shaped is stripped rather than trusted.
fn sanitise(run_id: &str) -> String {
    run_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(120)
        .collect()
}

fn read_dir_sorted(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    paths.sort();
    paths
}

/// Keeps the newest 200 runs. Timestamped names sort lexicographically by time,
/// so a reverse sort gives newest-first without touching the file contents.
fn prune(dir: &Path, keep: usize) -> Result<(), String> {
    let mut paths: Vec<PathBuf> = read_dir_sorted(dir)
        .into_iter()
        .filter(|p| p.extension().map(|e| e == "json").unwrap_or(false))
        .collect();
    if paths.len() <= keep {
        return Ok(());
    }
    paths.sort();
    while paths.len() > keep {
        let oldest = paths.remove(0);
        let _ = std::fs::remove_file(oldest);
    }
    Ok(())
}

// `dirs` is not in the dependency list; the app data dir is resolved through
// Tauri's own path resolver instead, which keeps one source of truth for where
// an app's data lives on each platform.
mod dirs {
    use std::path::PathBuf;

    /// Honours the platform convention without adding a crate: on Windows the
    /// roaming AppData location, elsewhere XDG. Tauri's app-data dir is
    /// resolved by the caller in `lib.rs`, which overrides these at runtime.
    pub fn config_dir() -> Option<PathBuf> {
        if cfg!(windows) {
            std::env::var_os("APPDATA").map(PathBuf::from)
        } else {
            std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        }
    }

    pub fn data_local_dir() -> Option<PathBuf> {
        if cfg!(windows) {
            std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
        } else {
            std::env::var_os("XDG_DATA_HOME")
                .map(PathBuf::from)
                .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Attempt, FamilyStat};

    fn sample_run(id: &str) -> ScanResult {
        ScanResult {
            run_id: id.into(),
            started_at: "2026-01-01T00:00:00Z".into(),
            finished_at: "2026-01-01T00:01:00Z".into(),
            target_model: "test-model".into(),
            judge_model: "judge".into(),
            total_attempts: 2,
            total_breaks: 1,
            overall_success_rate: 0.5,
            generations: 1,
            elapsed_ms: 60_000,
            family_stats: vec![FamilyStat {
                family: "direct".into(),
                attempts: 2,
                breaks: 1,
                refusals: 1,
                partial: 0,
                uncertain: 0,
                errors: 0,
                success_rate: 0.5,
                mean_fitness: 0.4,
            }],
            attempts: vec![],
findings: vec![],
            seed: 42,
            total_tokens: 0,
            expected_breaks: vec![],
        }
    }

    #[test]
    fn sanitise_strips_path_traversal() {
        assert_eq!(sanitise("../../etc/passwd"), "______etc_passwd");
        assert_eq!(sanitise("20260101-120000-42-gpt4"), "20260101-120000-42-gpt4");
        assert_eq!(sanitise("a/b"), "a_b");
        assert!(sanitise(&"x".repeat(500)).len() <= 120);
    }

    #[test]
    fn save_and_load_round_trip() {
        let result = sample_run("roundtrip-test-run");
        save(&result).expect("save works");
        let loaded = load("roundtrip-test-run").expect("load works");
        assert_eq!(loaded.run_id, "roundtrip-test-run");
        assert_eq!(loaded.total_breaks, 1);
        assert_eq!(loaded.attempts.len(), 0);
        remove("roundtrip-test-run").expect("remove works");
    }

    #[test]
    fn list_includes_a_saved_run_and_excludes_it_after_removal() {
        save(&sample_run("list-inclusion-test")).expect("save works");
        assert!(list().iter().any(|s| s.run_id == "list-inclusion-test"));
        remove("list-inclusion-test").expect("remove works");
        assert!(!list().iter().any(|s| s.run_id == "list-inclusion-test"));
    }

    #[test]
    fn loading_a_missing_run_is_an_error_not_a_panic() {
        assert!(load("definitely-not-here-42").is_err());
    }

    #[test]
    fn summary_derives_from_the_full_record() {
        let s = summary_of(&sample_run("x"));
        assert_eq!(s.target_model, "test-model");
        assert_eq!(s.seed, 42);
        assert!((s.overall_success_rate - 0.5).abs() < 1e-6);
    }

    #[test]
    fn attempt_records_serialise_as_camel_case() {
        // The frontend mirrors these shapes in src/types.ts; a rename here that
        // does not follow through would silently break the UI.
        let attempt = Attempt {
            probe_id: "P0-1".into(),
            family: "direct".into(),
            operators: vec!["prefill".into()],
            prompt: "p".into(),
            messages: vec![crate::model::Message::user("p")],
            response: "r".into(),
            verdict: crate::model::Verdict::uncertain(),
            latency_ms: 12,
            generation: 0,
            rewritten: false,
            fitness: 0.5,
            error: None,
            prompt_tokens: None,
            completion_tokens: None,
        };
        let json = serde_json::to_string(&attempt).unwrap();
        assert!(json.contains("\"probeId\""), "{json}");
        assert!(json.contains("\"latencyMs\""), "{json}");
        assert!(json.contains("\"voteConsensus\""), "{json}");
    }
}