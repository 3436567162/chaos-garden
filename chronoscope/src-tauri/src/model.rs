// Wire and on-disk cache types. Field names are camelCase on the wire so the
// TypeScript side can keep its usual naming.

use serde::{Deserialize, Serialize};

/// Bumped whenever scanning rules change; an older cache is discarded.
pub const CACHE_VERSION: u32 = 1;

/// Blobs above this size are omitted from the city: counting their lines would
/// mean decompressing megabytes of vendored bundles for no visual gain.
pub const MAX_BLOB_BYTES: usize = 2 * 1024 * 1024;

/// Upper bound on timeline stops. A repository with more commits is strided.
pub const MAX_SAMPLES: usize = 200;

/// Upper bound on `samples × files` cells sent to the frontend, which
/// materialises the whole grid as typed arrays.
pub const MAX_CELLS: usize = 4_000_000;

/// Upper bound on distinct paths across the whole history, which is what the
/// city size actually is: every file that ever existed keeps its own plot of
/// land, so a long-lived repository accumulates far more paths than it has at
/// HEAD. Exceeding this aborts the scan with an actionable message rather than
/// grinding for minutes and then failing.
pub const MAX_SLOTS: usize = 60_000;

/// Upper bound on the serialised delta payload. A repository with very dense
/// history changes a lot of files between two distant commits, so the wire cost
/// is not predictable from the file count alone; this catches the tail.
pub const MAX_PAYLOAD_BYTES: usize = 24 * 1024 * 1024;

/// How many directories to name when the slot budget is exceeded.
pub const TOP_DIR_REPORT: usize = 8;

/// A change relative to the previous sample. `None` lines means the path was
/// deleted at this point.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub lang: String,
    pub lines: Option<u32>,
    pub is_binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitMeta {
    pub oid: String,
    pub parents: Vec<String>,
    /// Unix seconds.
    pub timestamp: i64,
    /// First line of the commit message.
    pub message: String,
    pub author_name: String,
    pub author_email: String,
}

/// A sampled commit plus the changes it introduced relative to the previous
/// sample. The frontend replays these to rebuild any sample's file set.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    #[serde(flatten)]
    pub meta: CommitMeta,
    pub changes: Vec<FileChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub repo_name: String,
    pub head: String,
    pub commit_count: usize,
    pub first_timestamp: i64,
    pub last_timestamp: i64,
    /// Total file slots after ignore rules, i.e. the size of the city.
    pub file_count: usize,
    /// True when commits were strided down to fewer timeline stops.
    pub strided: bool,
    pub samples: Vec<Sample>,
    /// Cache was reused because HEAD had not moved.
    pub from_cache: bool,
}

/// Reported when the history contains more distinct paths than a city can hold.
#[derive(Debug, Clone)]
pub struct SlotOverflow {
    pub limit: usize,
    pub seen: usize,
    pub top_dirs: Vec<(String, usize)>,
}

impl SlotOverflow {
    /// A message the UI can show verbatim, naming the directories responsible.
    pub fn message(&self) -> String {
        let dirs = self
            .top_dirs
            .iter()
            .map(|(d, n)| format!("{d} ({n})"))
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "This repository's history contains {} distinct paths, over the limit of {}. \
             The city cannot hold them. Busiest directories: {}",
            self.seen, self.limit, dirs
        )
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub phase: String,
    pub done: usize,
    pub total: usize,
}

/// Per-blob facts that are expensive to recompute, keyed by blob OID. This map
/// is the reason a warm scan costs no blob decompression at all.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobInfo {
    /// `None` when the blob exceeded `MAX_BLOB_BYTES` and is left out.
    pub lines: Option<u32>,
    pub is_binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cache {
    pub version: u32,
    /// Canonical repository path this cache belongs to.
    pub repo: String,
    /// HEAD when the cache was written; a mismatch invalidates it.
    pub head: String,
    /// Every commit, oldest first.
    pub commits: Vec<CommitMeta>,
    /// Indices into `commits` that became timeline stops.
    pub samples: Vec<usize>,
    /// Union of paths across all samples; also the city size.
    pub paths: Vec<String>,
    pub blobs: std::collections::HashMap<String, BlobInfo>,
}