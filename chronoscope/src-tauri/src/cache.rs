// On-disk cache. One JSON file per repository, keyed by a hash of its path.
//
// The expensive artefact is the blob table: it is what makes a warm scan skip
// every decompress. Validity is decided by (version, canonical path, HEAD), so
// a moved HEAD or a rule change simply discards the file.
//
// In memory the table is keyed by `git2::Oid`; JSON needs string keys, so the
// hex conversion happens here, at the boundary, and nowhere else.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use git2::Oid;
use tauri::{AppHandle, Manager};

use crate::model::{Cache, CACHE_VERSION};
use crate::scan::BlobTable;

/// FNV-1a, used only to derive a filename from a path.
fn hash_path(path: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.as_bytes() {
        h ^= u64::from(*byte);
        h = h.wrapping_mul(0x1000_0000_01b3);
    }
    format!("{h:016x}")
}

fn cache_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("repos");
    std::fs::create_dir_all(&dir).ok()?;
    dir.into()
}

fn cache_file(app: &AppHandle, repo: &str) -> Option<PathBuf> {
    Some(cache_dir(app)?.join(format!("{}.json", hash_path(repo))))
}

/// A cache hit: the on-disk metadata plus the blob table keyed by `Oid`.
pub struct Hit {
    pub cache: Cache,
    pub blobs: BlobTable,
}

/// Loads a cache if it matches `repo` and `head`; otherwise returns `None`.
pub fn load(app: &AppHandle, repo: &str, head: &str) -> Option<Hit> {
    let path = cache_file(app, repo)?;
    let bytes = std::fs::read(path).ok()?;
    let mut cache: Cache = serde_json::from_slice(&bytes).ok()?;
    if cache.version != CACHE_VERSION || cache.repo != repo || cache.head != head {
        return None;
    }
    let encoded = std::mem::take(&mut cache.blobs);
    let blobs = encoded
        .into_iter()
        .filter_map(|(oid, info)| Oid::from_str(&oid).ok().map(|o| (o, info)))
        .collect();
    Some(Hit { cache, blobs })
}

/// Writes the cache, dropping the blob table if it has grown unreasonable.
pub fn save(app: &AppHandle, cache: Cache, blobs: &BlobTable) {
    let Some(path) = cache_file(app, &cache.repo) else {
        return;
    };
    let mut cache = cache;
    cache.blobs = if blobs.len() > 400_000 {
        // Bounded so a monorepo cannot fill the disk. Losing entries only costs
        // speed on the next scan, never correctness.
        HashMap::new()
    } else {
        blobs
            .iter()
            .map(|(oid, info)| (oid.to_string(), *info))
            .collect()
    };
    if let Ok(bytes) = serde_json::to_vec(&cache) {
        let _ = std::fs::write(path, bytes);
    }
}

/// Canonical path of a repository, resolving `.git` directories and worktrees.
pub fn canonical(repo: &Path) -> Result<String, git2::Error> {
    Ok(git2::Repository::discover(repo)?
        .workdir()
        .unwrap_or(repo)
        .to_string_lossy()
        .into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BlobInfo;

    #[test]
    fn path_hash_is_stable_and_distinct() {
        assert_eq!(hash_path("C:/a"), hash_path("C:/a"));
        assert_ne!(hash_path("C:/a"), hash_path("C:/b"));
        assert_eq!(hash_path("C:/a").len(), 16);
    }

    #[test]
    fn blob_table_survives_a_hex_round_trip() {
        let oid = Oid::from_str("1234567890123456789012345678901234567890").unwrap();
        let mut blobs: BlobTable = HashMap::new();
        blobs.insert(
            oid,
            BlobInfo {
                lines: Some(7),
                is_binary: false,
            },
        );
        let encoded: HashMap<String, BlobInfo> = blobs
            .iter()
            .map(|(o, i)| (o.to_string(), *i))
            .collect();
        let decoded: BlobTable = encoded
            .into_iter()
            .filter_map(|(o, i)| Oid::from_str(&o).ok().map(|p| (p, i)))
            .collect();
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[&oid].lines, Some(7));
    }
}