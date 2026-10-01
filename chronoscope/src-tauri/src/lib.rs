mod cache;
mod lang;
mod model;
mod scan;

use std::collections::HashMap;

use tauri::{AppHandle, Emitter, State};

use model::{Cache, ScanProgress, ScanResult};

/// Everything the scanner can fail at, flattened into one message the UI shows.
struct ScanError(String);

/// Serialises as a plain string, which is what the frontend surfaces directly.
impl serde::Serialize for ScanError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

type Result<T> = std::result::Result<T, ScanError>;

impl From<git2::Error> for ScanError {
    fn from(e: git2::Error) -> Self {
        Self(e.message().to_string())
    }
}

/// Repositories currently being scanned, so a second request joins rather than
/// duplicating the work.
#[derive(Default)]
struct Running(std::sync::Mutex<HashMap<String, ()>>);

/// Scans a local repository. Fully offline: `git2` reads `.git` directly.
#[tauri::command]
async fn scan_repository(
    app: AppHandle,
    running: State<'_, Running>,
    path: String,
) -> Result<ScanResult> {
    let requested = std::path::PathBuf::from(&path);
    let opened =
        git2::Repository::discover(&requested).or_else(|_| git2::Repository::open(&requested));
    let repo = opened.map_err(|e| ScanError(format!("{path} is not a Git repository: {}", e.message())))?;
    let canonical = cache::canonical(&requested)?;

    let head = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .map_or_else(String::new, |o| o.to_string());

    // Claim the repository for the duration of the scan.
    {
        let mut guard = running.0.lock().expect("scan lock poisoned");
        if guard.contains_key(&canonical) {
            return Err(ScanError("this repository is already being scanned".into()));
        }
        guard.insert(canonical.clone(), ());
    }
    let outcome = scan_locked(&app, &repo, &canonical, &head);
    running
        .0
        .lock()
        .expect("scan lock poisoned")
        .remove(&canonical);
    outcome
}

fn scan_locked(
    app: &AppHandle,
    repo: &git2::Repository,
    canonical: &str,
    head: &str,
) -> Result<ScanResult> {
    let repo_name = repo
        .workdir()
        .and_then(|w| w.file_name())
        .map_or_else(|| canonical.to_string(), |n| n.to_string_lossy().into_owned());

    // Warm path: nothing has changed since last time, so blobs are never read.
    if let Some(hit) = cache::load(app, canonical, head) {
        let built = scan::build_samples(repo, &hit.cache.commits, &hit.cache.samples, &mut { hit.blobs }, |_, _| {})?;
        if let Some(overflow) = built.overflow {
            return Err(ScanError(overflow.message()));
        }
        return Ok(ScanResult {
            repo_name,
            head: head.to_string(),
            commit_count: hit.cache.commits.len(),
            first_timestamp: hit.cache.commits.first().map_or(0, |c| c.timestamp),
            last_timestamp: hit.cache.commits.last().map_or(0, |c| c.timestamp),
            file_count: hit.cache.paths.len(),
            strided: hit.cache.commits.len() > hit.cache.samples.len(),
            samples: built.samples,
            from_cache: true,
        });
    }

    emit(app, "commits", 0, 0);
    let commits = scan::commit_list(repo)?;
    if commits.is_empty() {
        return Err(ScanError("this repository has no commits yet".into()));
    }
    let commit_count = commits.len();

    // Size the sample budget before doing any real work. One tree walk with no
    // blob reads is cheap; it tells us how many stops the city can afford.
    let head_files = scan::file_count_at(repo, commits.last().expect("non-empty"))?;
    if head_files > model::MAX_SLOTS {
        return Err(ScanError(format!(
            "{repo_name} alone tracks {head_files} files, more than the city limit of {}",
            model::MAX_SLOTS
        )));
    }
    let affordable = (model::MAX_CELLS / head_files.max(1)).clamp(1, model::MAX_SAMPLES);
    let indices = scan::sample_indices_limited(commit_count, affordable);

let mut blobs = scan::BlobTable::new();
    let built = build_and_report(app, repo, &commits, &indices, &mut blobs)?;
    if let Some(overflow) = built.overflow {
        return Err(ScanError(overflow.message()));
    }
    let samples = built.samples;
    let paths = scan::paths_of(&samples);
    if paths.is_empty() {
        return Err(ScanError(format!(
            "{repo_name} has no files left after ignore rules. \
             Everything tracked sits in an ignored directory such as \
             node_modules, target or dist."
        )));
    }

    // The wire cost is dominated by how much churn sits between two distant
    // sampled commits, which the file count cannot predict. Check it for real
    // rather than shipping tens of megabytes over IPC.
    if let Ok(bytes) = serde_json::to_vec(&samples) {
        if bytes.len() > model::MAX_PAYLOAD_BYTES {
            return Err(ScanError(format!(
                "This repository's history is too dense to send: {} MB of change \
                 data for {} stops, over the {} MB limit. Try a repository with \
                 fewer commits, or one with a sparser history.",
                bytes.len() / 1_000_000,
                samples.len(),
                model::MAX_PAYLOAD_BYTES / 1_000_000
            )));
        }
    }

    let first_timestamp = commits.first().map_or(0, |c| c.timestamp);
    let last_timestamp = commits.last().map_or(0, |c| c.timestamp);
    let strided = commit_count > samples.len();

    emit(app, "saving", 0, 1);
    cache::save(
        app,
        Cache {
            version: model::CACHE_VERSION,
            repo: canonical.to_string(),
            head: head.to_string(),
            commits,
            samples: indices,
            paths: paths.clone(),
            blobs: HashMap::new(),
        },
        &blobs,
    );

    Ok(ScanResult {
        repo_name,
        head: head.to_string(),
        commit_count,
        first_timestamp,
        last_timestamp,
        file_count: paths.len(),
        strided,
        samples,
        from_cache: false,
    })
}

/// Builds the samples, reporting progress as each tree is walked.
fn build_and_report(
    app: &AppHandle,
    repo: &git2::Repository,
    commits: &[model::CommitMeta],
    indices: &[usize],
    blobs: &mut scan::BlobTable,
) -> Result<scan::Built> {
    let total = indices.len();
    Ok(scan::build_samples(repo, commits, indices, blobs, |done, _| {
        emit(app, "trees", done, total)
    })?)
}

fn emit(app: &AppHandle, phase: &str, done: usize, total: usize) {
    let _ = app.emit(
        "scan-progress",
        ScanProgress {
            phase: phase.to_string(),
            done,
            total,
        },
    );
}

/// Appends a line to `bench.log` in the app data directory.
///
/// A benchmark's numbers live in the WebView, whose `console.log` never reaches
/// the terminal that launched it, so this is the only way to read a stress run
/// back. Release builds compile the body out and keep the command as a no-op,
/// so the handler list does not change shape between build profiles.
#[tauri::command]
fn write_bench_log(app: AppHandle, line: String) {
    #[cfg(debug_assertions)]
    {
        use std::io::Write;
        let Some(dir) = tauri::Manager::path(&app).app_data_dir().ok() else {
            return;
        };
        if std::fs::create_dir_all(&dir).is_err() {
            return;
        }
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("bench.log"))
        {
            let _ = writeln!(file, "{line}");
        }
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (app, line);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Running::default())
        .invoke_handler(tauri::generate_handler![scan_repository, write_bench_log])
        .run(tauri::generate_context!())
        .expect("error while running chronoscope");
}

#[cfg(test)]
mod wire {
    //! Guards the JSON contract with the TypeScript side. A rename on the Rust
    //! struct that is not mirrored in `src/types.ts` fails here rather than at
    //! runtime, where it would show up as an undefined field.

    use std::collections::HashMap;

    use super::*;

    #[test]
    fn scan_result_serialises_as_camel_case() {
        let result = ScanResult {
            repo_name: "demo".into(),
            head: "abc".into(),
            commit_count: 3,
            first_timestamp: 1,
            last_timestamp: 2,
            file_count: 1,
            strided: false,
            samples: vec![model::Sample {
                meta: model::CommitMeta {
                    oid: "abc".into(),
                    parents: vec![],
                    timestamp: 2,
                    message: "hello".into(),
                    author_name: "Ada".into(),
                    author_email: "ada@example.com".into(),
                },
                changes: vec![model::FileChange {
                    path: "src/main.rs".into(),
                    lang: "Rust".into(),
                    lines: Some(42),
                    is_binary: false,
                }],
            }],
            from_cache: false,
        };

        let json = serde_json::to_value(&result).unwrap();
        for key in [
            "repoName",
            "head",
            "commitCount",
            "firstTimestamp",
            "lastTimestamp",
            "fileCount",
            "strided",
            "samples",
            "fromCache",
        ] {
            assert!(json.get(key).is_some(), "missing key {key} in {json}");
        }

        let sample = &json["samples"][0];
        for key in [
            "oid",
            "parents",
            "timestamp",
            "message",
            "authorName",
            "authorEmail",
            "changes",
        ] {
            assert!(sample.get(key).is_some(), "missing sample key {key} in {sample}");
        }

        let change = &sample["changes"][0];
        for key in ["path", "lang", "lines", "isBinary"] {
            assert!(change.get(key).is_some(), "missing change key {key} in {change}");
        }
        assert_eq!(change["lines"], serde_json::json!(42));
    }

    #[test]
    fn deletions_serialise_lines_as_null() {
        let change = model::FileChange {
            path: "gone.rs".into(),
            lang: String::new(),
            lines: None,
            is_binary: false,
        };
        let json = serde_json::to_value(&change).unwrap();
        assert!(json["lines"].is_null(), "deleted paths must send null, got {json}");
    }

    #[test]
    fn errors_serialise_as_a_plain_string() {
        let json = serde_json::to_value(ScanError("boom".into())).unwrap();
        assert_eq!(json, serde_json::json!("boom"));
    }

    #[test]
    fn cache_round_trips() {
        let key = "0".repeat(40);
        let cache = Cache {
            version: model::CACHE_VERSION,
            repo: "C:/repo".into(),
            head: "deadbeef".into(),
            commits: vec![model::CommitMeta {
                oid: "deadbeef".into(),
                parents: vec!["cafe".into()],
                timestamp: 1_700_000_000,
                message: "chore: init".into(),
                author_name: "Ada".into(),
                author_email: "ada@example.com".into(),
            }],
            samples: vec![0],
            paths: vec!["src/main.rs".into()],
            blobs: HashMap::from([(
                key.clone(),
                model::BlobInfo {
                    lines: Some(42),
                    is_binary: false,
                },
            )]),
        };
        let text = serde_json::to_string(&cache).unwrap();
        let back: Cache = serde_json::from_str(&text).unwrap();
        assert_eq!(back.head, cache.head);
        assert_eq!(back.blobs[&key].lines, Some(42));
        assert_eq!(back.samples, cache.samples);
        assert_eq!(back.paths, cache.paths);
    }
}