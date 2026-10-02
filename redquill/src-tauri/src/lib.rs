// Tauri command surface and app wiring.

pub mod advice;
pub mod client;
pub mod corpus;
pub mod evolve;
pub mod judge;
pub mod model;
pub mod mutate;
pub mod provenance;
pub mod rng;
pub mod scan;
pub mod seeds;
pub mod store;
pub mod transcript;

#[cfg(feature = "test-support")]
pub mod testing;

pub use model::{Endpoint, JudgeConfig, ScanConfig, ScanResult};

use model::{FamilyInfo, RunSummary};
use scan::CancelFlag;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// Bridges the decoupled engine back onto Tauri's event system.
struct TauriSink(AppHandle);

impl scan::EventSink for TauriSink {
    fn progress(&self, progress: &model::ScanProgress) {
        let _ = self.0.emit(scan::EVENT_PROGRESS, progress);
    }

    fn finished(&self, result: &ScanResult, error: Option<&str>) {
        match error {
            Some(message) => {
                // A run-level failure rides the same channel as a success so the
                // UI only has one listener for "the run is over".
                let _ = self
                    .0
                    .emit(scan::EVENT_FINISHED, serde_json::json!({ "error": message }));
            }
            None => {
                let _ = self.0.emit(scan::EVENT_FINISHED, result);
            }
        }
    }
}

/// Cancellation flags for in-flight runs, keyed by run id assigned at start.
/// Cleared when the run ends so the map does not grow across sessions.
#[derive(Default)]
struct AppState {
    cancels: Mutex<HashMap<String, CancelFlag>>,
    /// Global verdict cache shared across runs: re-scanning the same target
    /// with a tweaked population should not re-pay for identical judgements.
    cache: Arc<judge::VerdictCache>,
}

impl AppState {
    fn register(&self, key: &str) -> CancelFlag {
        let flag: CancelFlag = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = self.cancels.lock() {
            map.insert(key.to_string(), flag.clone());
        }
        flag
    }

    fn deregister(&self, key: &str) {
        if let Ok(mut map) = self.cancels.lock() {
            map.remove(key);
        }
    }

    fn cancel(&self, key: &str) -> bool {
        self.cancels
            .lock()
            .ok()
            .and_then(|map| map.get(key).cloned())
            .map(|flag| {
                flag.store(true, std::sync::atomic::Ordering::Relaxed);
                true
            })
            .unwrap_or(false)
    }
}

impl TauriSink {
    /// Reports a run that failed before it produced a result.
    fn finished_fallback(&self, error: &str) {
        let _ = self
            .0
            .emit(scan::EVENT_FINISHED, serde_json::json!({ "error": error }));
    }
}

/// Headless sink: prints progress to stderr and leaves the result to the caller.
/// This is what the CLI (`examples/rq-scan.rs`) and any CI regression job use.
pub struct StderrSink {
    pub quiet: bool,
}

impl scan::EventSink for StderrSink {
    fn progress(&self, progress: &model::ScanProgress) {
        if self.quiet {
            return;
        }
        let pct = progress.done.saturating_mul(100) / progress.total.max(1);
        let latest = progress.latest.as_ref().map(|a| {
            format!(
                " {} [{}] conf {:.2}{}",
                a.probe_id,
                a.verdict.label,
                a.verdict.confidence,
                if a.verdict.disputed { " disputed" } else { "" }
            )
        });
        eprintln!(
            "[{pct:>3}%] gen {}/{} · breaks {} · best {:.3}{}",
            progress.generation + 1,
            progress.total_generations,
            progress.breaks,
            progress.best_fitness,
            latest.unwrap_or_default()
        );
    }

    fn finished(&self, _result: &ScanResult, error: Option<&str>) {
        if let Some(message) = error {
            eprintln!("run failed: {message}");
        }
    }
}

/// Runs a scan without a UI. Same engine, same judging, same report — only the
/// event sink differs, which is the point: a regression job should exercise the
/// identical pipeline the desktop app runs.
pub async fn run_headless(
    sink: &dyn scan::EventSink,
    config: ScanConfig,
) -> Result<ScanResult, String> {
    let cancel: scan::CancelFlag = Arc::new(AtomicBool::new(false));
    scan::run_scan(sink, config, cancel, state_cache()).await
}

/// The process-wide verdict cache the app also uses. Re-scanning the same
/// target with a tweaked population should not re-pay for identical judgements.
fn state_cache() -> Arc<judge::VerdictCache> {
    use std::sync::OnceLock;
    static CACHE: OnceLock<Arc<judge::VerdictCache>> = OnceLock::new();
    CACHE.get_or_init(|| Arc::new(judge::VerdictCache::default())).clone()
}

/// Progress is streamed over events; this command only starts the run.
#[tauri::command]
async fn start_scan(
    app: AppHandle,
    state: State<'_, AppState>,
    config: ScanConfig,
) -> Result<String, String> {
    if !config.authorised {
        return Err(
            "target not confirmed as yours or as authorised for testing; tick the authorisation \
             box before scanning"
                .into(),
        );
    }

    // Key the run by model + seed + start time so two scans of the same target
    // stay independently cancellable.
    let key = format!(
        "{}:{}:{}",
        config.target.model,
        config.seed,
        chrono::Utc::now().timestamp_millis()
    );
    let cancel = state.register(&key);
    let cache = state.cache.clone();
    let run_key = key.clone();
    let sink = TauriSink(app.clone());

    tauri::async_runtime::spawn(async move {
        let result = scan::run_scan(&sink, config, cancel, cache).await;
        app.state::<AppState>().deregister(&run_key);
        if let Err(e) = result {
            sink.finished_fallback(&e);
        }
    });

    Ok(key)
}

#[tauri::command]
fn cancel_scan(state: State<'_, AppState>, run_key: String) -> Result<(), String> {
    if state.cancel(&run_key) {
        Ok(())
    } else {
        Err("run is not active".into())
    }
}

/// Lists the attack families bundled with this build.
#[tauri::command]
fn list_families() -> Vec<FamilyInfo> {
    seeds::infos()
}

/// Reachability check with a single tiny completion, so the operator finds out
/// about a wrong model id before committing to a full scan.
#[tauri::command]
async fn test_endpoint(endpoint: model::Endpoint) -> Result<String, String> {
    let http = client::client(30)?;
    client::ping(&http, &endpoint).await
}

#[tauri::command]
async fn list_models(endpoint: model::Endpoint) -> Result<Vec<String>, String> {
    let http = client::client(30)?;
    client::list_models(&http, &endpoint).await
}

#[tauri::command]
fn list_runs() -> Vec<RunSummary> {
    store::list()
}

#[tauri::command]
fn load_run(run_id: String) -> Result<ScanResult, String> {
    store::load(&run_id)
}

#[tauri::command]
fn delete_run(run_id: String) -> Result<(), String> {
    store::remove(&run_id)
}

#[tauri::command]
fn export_run(run_id: String, destination: String) -> Result<(), String> {
    store::export(&run_id, std::path::Path::new(&destination))
}

/// Seeds the run with a different value without the operator inventing one.
#[tauri::command]
fn suggest_seed() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64 ^ (d.as_secs() << 17))
        .unwrap_or(0x5eed_1234_abcd_0001)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            start_scan,
            cancel_scan,
            list_families,
            test_endpoint,
            list_models,
            list_runs,
            load_run,
            delete_run,
            export_run,
            suggest_seed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running redquill");
}