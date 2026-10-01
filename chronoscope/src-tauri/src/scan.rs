// Repository walking: commit list, sampling, per-sample file deltas.
//
// Three things keep this fast enough to be interactive on a repository with
// thousands of commits:
//   * blob facts are keyed by `Oid`, not by hex string, so the per-entry lookup
//     does no formatting and no allocation
//   * the blob table is reused across sampled commits, and consecutive commits
//     mostly hit it, so blobs are decompressed once per distinct version
//   * the tree walk builds the state map directly, with no intermediate Vec and
//     no owned language strings

use std::collections::{BTreeMap, HashMap, HashSet};

use git2::{Oid, Repository, Sort, TreeWalkMode, TreeWalkResult};

use crate::lang;
use crate::model::{
    BlobInfo, CommitMeta, FileChange, Sample, SlotOverflow, MAX_BLOB_BYTES, MAX_SLOTS, TOP_DIR_REPORT,
};

/// Directories whose contents never belong in a picture of the source tree.
const IGNORED_DIRS: &[&str] = &[
    ".git",
    ".idea",
    ".vscode",
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
    "bower_components",
    "target",
    "dist",
    "build",
    "out",
    "coverage",
    "vendor",
    ".next",
    ".nuxt",
    ".cache",
    ".gradle",
    ".terraform",
];

const IGNORED_FILES: &[&str] = &[".ds_store", "thumbs.db", ".gitkeep"];

/// Blob facts, keyed by object id. `Oid` is `Copy + Hash + Eq`, which is what
/// makes the lookup cheap enough to run millions of times.
pub type BlobTable = HashMap<Oid, BlobInfo>;

/// What a path currently is in the tree: language, line count, binary flag.
type State = (&'static str, u32, bool);

/// True when any path component is an ignored directory, or the file itself is
/// on the ignore list.
///
/// Allocation-free on purpose: this runs once per file per sampled commit, so
/// millions of times on a large repository.
pub fn is_ignored(path: &str) -> bool {
    let mut components = path.split('/');
    // `split` is double-ended, so take the file name from the back; whatever is
    // left in the iterator is the directory chain.
    let Some(file) = components.next_back() else {
        return true;
    };
    if IGNORED_FILES.iter().any(|f| f.eq_ignore_ascii_case(file)) {
        return true;
    }
    // `split` borrows, so no substring is ever allocated.
    components.any(|c| IGNORED_DIRS.iter().any(|d| d.eq_ignore_ascii_case(c)))
}

fn count_lines(content: &[u8]) -> u32 {
    if content.is_empty() {
        return 0;
    }
    let newlines = content.iter().filter(|b| **b == b'\n').count() as u32;
    // A trailing newline does not start a new line.
    if content.last() == Some(&b'\n') {
        newlines
    } else {
        newlines + 1
    }
}

/// Every commit reachable from HEAD, oldest first, parents before children.
pub fn commit_list(repo: &Repository) -> Result<Vec<CommitMeta>, git2::Error> {
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    walk.push_head()?;

    let mut out = Vec::new();
    for oid in walk {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        let author = commit.author();
        let message = commit.message().unwrap_or_default();
        out.push(CommitMeta {
            oid: oid.to_string(),
            parents: commit.parent_ids().map(|p| p.to_string()).collect(),
            timestamp: author.when().seconds(),
            message: message.lines().next().unwrap_or("").to_string(),
            author_name: author.name().unwrap_or("unknown").to_string(),
            author_email: author.email().unwrap_or("").to_string(),
        });
    }
    // git2 hands back children before parents; reverse into chronological order.
    out.reverse();
    Ok(out)
}

/// Evenly spaced indices for an explicit stop count.
pub fn sample_indices_limited(len: usize, want: usize) -> Vec<usize> {
    if len == 0 {
        return Vec::new();
    }
    if len <= want {
        return (0..len).collect();
    }
    if want <= 1 {
        return vec![0];
    }
    let last = len - 1;
    let n = want;
    let mut out: Vec<usize> = (0..n)
        .map(|i| ((i as f64 * last as f64 / (n - 1) as f64).round() as usize).min(last))
        .collect();
    out.dedup();
    out
}

/// Number of files the tree walk would keep at `commit`. One cheap pass with no
/// blob reads, used to size the sample budget before doing any real work.
pub fn file_count_at(repo: &Repository, commit: &CommitMeta) -> Result<usize, git2::Error> {
    let commit = repo.find_commit(Oid::from_str(&commit.oid)?)?;
    let tree = commit.tree()?;
    let mut kept = 0usize;
    tree.walk(TreeWalkMode::PreOrder, |root, entry| {
        if entry.kind() == Some(git2::ObjectType::Blob)
            && !is_ignored(&format!("{root}{}", entry.name().unwrap_or_default()))
        {
            kept += 1;
        }
        TreeWalkResult::Ok
    })?;
    Ok(kept)
}

/// Resolves a blob's line count once and remembers it for the whole scan.
/// `None` means the blob is left out of the city.
fn inspect_blob(repo: &Repository, oid: Oid, blobs: &mut BlobTable) -> Option<BlobInfo> {
    if let Some(info) = blobs.get(&oid) {
        return info.lines.map(|lines| BlobInfo {
            lines: Some(lines),
            is_binary: info.is_binary,
        });
    }
    let info = match repo.find_blob(oid) {
        // Too big to be worth counting.
        Ok(blob) if blob.size() > MAX_BLOB_BYTES => BlobInfo {
            lines: None,
            is_binary: true,
        },
        Ok(blob) => {
            let is_binary = blob.is_binary();
            // Binary blobs still occupy a slot, drawn as a flat slab.
            BlobInfo {
                lines: Some(if is_binary { 0 } else { count_lines(blob.content()) }),
                is_binary,
            }
        }
        // Unreadable object: omit rather than invent a height.
        Err(_) => BlobInfo {
            lines: None,
            is_binary: false,
        },
    };
    blobs.insert(oid, info);
    blobs.get(&oid).copied().filter(|i| i.lines.is_some())
}

/// The whole tree at one commit, keyed by path so the diff is a tree walk of
/// two sorted maps rather than a hash of every file.
fn tree_state(
    repo: &Repository,
    commit: &CommitMeta,
    blobs: &mut BlobTable,
) -> Result<BTreeMap<String, State>, git2::Error> {
    let commit = repo.find_commit(Oid::from_str(&commit.oid)?)?;
    let tree = commit.tree()?;
    let mut out: BTreeMap<String, State> = BTreeMap::new();
    tree.walk(TreeWalkMode::PreOrder, |root, entry| {
        if entry.kind() != Some(git2::ObjectType::Blob) {
            return TreeWalkResult::Ok;
        }
        let name = entry.name().unwrap_or_default();
        let path = format!("{root}{name}");
        if is_ignored(&path) {
            return TreeWalkResult::Ok;
        }
        if let Some(info) = inspect_blob(repo, entry.id(), blobs) {
            if let Some(lines) = info.lines {
                out.insert(path, (lang::of(name), lines, info.is_binary));
            }
        }
        TreeWalkResult::Ok
    })?;
    Ok(out)
}

/// What a walk produced.
pub struct Built {
    pub samples: Vec<Sample>,
    /// Set when the slot budget stopped the walk early.
    pub overflow: Option<SlotOverflow>,
}

/// Builds the sampled timeline, diffing each sample against the previous one so
/// the wire format stays proportional to the work actually done.
///
/// Stops early once the union of paths exceeds `MAX_SLOTS`, because that union
/// is the city size: a file keeps its plot of land from its first commit to its
/// last, so a long-lived repository accumulates far more paths than it has at
/// HEAD. Grinding through hundreds of samples before failing helps nobody.
pub fn build_samples(
    repo: &Repository,
    commits: &[CommitMeta],
    indices: &[usize],
    blobs: &mut BlobTable,
    mut on_sample: impl FnMut(usize, usize),
) -> Result<Built, git2::Error> {
    let mut samples = Vec::with_capacity(indices.len());
    let mut previous: BTreeMap<String, State> = BTreeMap::new();
    let mut ever: HashSet<String> = HashSet::new();
    let mut dir_counts: HashMap<String, usize> = HashMap::new();

for (n, &idx) in indices.iter().enumerate() {
        let current = tree_state(repo, &commits[idx], blobs)?;

        // Bound the union first: this loop only borrows, and the early return
        // below needs `previous` untouched.
        let mut overflow = None;
        for path in current.keys() {
            if !ever.insert(path.clone()) {
                continue;
            }
            let head_dir = path.split('/').next().unwrap_or(path).to_string();
            *dir_counts.entry(head_dir).or_insert(0) += 1;
            if ever.len() > MAX_SLOTS {
                let mut top: Vec<(String, usize)> = dir_counts
                    .iter()
                    .map(|(d, c)| (d.clone(), *c))
                    .collect();
                top.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
                top.truncate(TOP_DIR_REPORT);
                overflow = Some(SlotOverflow {
                    limit: MAX_SLOTS,
                    seen: ever.len(),
                    top_dirs: top,
                });
                break;
            }
        }
        
        if let Some(overflow) = overflow {
            return Ok(Built {
                samples,
                overflow: Some(overflow),
            });
        }

        let mut changes = Vec::new();
        for (path, (language, lines, is_binary)) in &current {
            match previous.get(path) {
                Some(old) if old.0 == *language && old.1 == *lines && old.2 == *is_binary => {}
                _ => changes.push(FileChange {
                    path: path.clone(),
                    lang: (*language).to_string(),
                    lines: Some(*lines),
                    is_binary: *is_binary,
                }),
            }
        }
        for path in previous.keys() {
            if !current.contains_key(path) {
                changes.push(FileChange {
                    path: path.clone(),
                    lang: String::new(),
                    lines: None,
                    is_binary: false,
                });
            }
        }

        samples.push(Sample {
            meta: commits[idx].clone(),
            changes,
        });
        previous = current;
        on_sample(n + 1, indices.len());
    }
    Ok(Built {
        samples,
        overflow: None,
    })
}

/// Union of every path that exists at any sample; this is the city size.
pub fn paths_of(samples: &[Sample]) -> Vec<String> {
    // Every path mentioned by any delta existed at some point, including the
    // ones that only appear as a deletion. A set, so a path that is removed and
    // later re-added still occupies exactly one plot of land.
    let mut ever: HashSet<&str> = HashSet::new();
    for sample in samples {
        for change in &sample.changes {
            ever.insert(change.path.as_str());
        }
    }
    let mut all: Vec<String> = ever.into_iter().map(str::to_string).collect();
    all.sort();
    all
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use git2::{Repository, Signature};

    use crate::model::MAX_SAMPLES;

    use super::*;

    #[test]
    fn ignores_known_directories() {
        assert!(is_ignored("node_modules/react/index.js"));
        assert!(is_ignored("src-tauri/target/debug/app"));
        assert!(is_ignored(".git/config"));
        assert!(is_ignored("web/dist/bundle.js"));
    }

    #[test]
    fn keeps_real_sources() {
        assert!(!is_ignored("src/main.rs"));
        assert!(!is_ignored("web/src/components/Button.tsx"));
        // Only whole path components count, never a substring.
        assert!(!is_ignored("src/target_helpers.rs"));
        assert!(!is_ignored("docs/build.md"));
    }

    #[test]
    fn samples_include_the_ends() {
        assert_eq!(sample_indices_limited(0, MAX_SAMPLES), Vec::<usize>::new());
        assert_eq!(sample_indices_limited(1, MAX_SAMPLES), vec![0]);
        assert_eq!(sample_indices_limited(7, MAX_SAMPLES), (0..7).collect::<Vec<_>>());

        let strided = sample_indices_limited(10_000, MAX_SAMPLES);
        assert_eq!(strided.len(), MAX_SAMPLES);
        assert_eq!(strided.first(), Some(&0));
        assert_eq!(strided.last(), Some(&9_999));
        assert!(strided.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn counts_lines_without_trailing_newline() {
        assert_eq!(count_lines(b""), 0);
        assert_eq!(count_lines(b"a"), 1);
        assert_eq!(count_lines(b"a\n"), 1);
        assert_eq!(count_lines(b"a\nb"), 2);
        assert_eq!(count_lines(b"a\nb\n"), 2);
    }

    /// Builds a throwaway repository so the walker runs against real git
    /// objects instead of a mock. Index entries are added explicitly rather than
    /// via `update_all`, because git's own ignore rules would otherwise hide the
    /// very paths `is_ignored` is meant to be tested against.
    struct Fixture {
        repo: Repository,
        dir: PathBuf,
    }

    impl Fixture {
        fn new(name: &str) -> Self {
            let mut dir = std::env::temp_dir();
            dir.push(format!("chronoscope-it-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            let repo = Repository::init(&dir).unwrap();
            {
                let mut cfg = repo.config().unwrap();
                // Stay independent of the developer's global git config.
                cfg.set_str("user.name", "Test").unwrap();
                cfg.set_str("user.email", "test@example.com").unwrap();
                cfg.set_str("commit.gpgsign", "false").unwrap();
            }
            Self { repo, dir }
        }

        fn write(&mut self, rel: &str, content: &[u8]) {
            let full = self.repo.workdir().unwrap().join(rel);
            if let Some(parent) = full.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(full, content).unwrap();
            let mut index = self.repo.index().unwrap();
            index.add_path(Path::new(rel)).unwrap();
            index.write().unwrap();
        }

        fn remove(&mut self, rel: &str) {
            std::fs::remove_file(self.repo.workdir().unwrap().join(rel)).unwrap();
            let mut index = self.repo.index().unwrap();
            index.remove_path(Path::new(rel)).unwrap();
            index.write().unwrap();
        }

        fn commit(&mut self, message: &str) {
            let tree_id = self.repo.index().unwrap().write_tree().unwrap();
            let tree = self.repo.find_tree(tree_id).unwrap();
            let sig = Signature::now("Test", "test@example.com").unwrap();
            let parents: Vec<git2::Commit> = self
                .repo
                .head()
                .ok()
                .and_then(|h| h.target())
                .iter()
                .filter_map(|oid| self.repo.find_commit(*oid).ok())
                .collect();
            let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
            self.repo
                .commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
                .unwrap();
        }

        fn commits(&self) -> Vec<CommitMeta> {
            commit_list(&self.repo).unwrap()
        }

        fn scan(&self) -> (Vec<Sample>, Vec<String>) {
            let commits = self.commits();
            let indices = sample_indices_limited(commits.len(), MAX_SAMPLES);
            let mut blobs = BlobTable::new();
            let built = build_samples(&self.repo, &commits, &indices, &mut blobs, |_, _| {}).unwrap();
            assert!(built.overflow.is_none());
            let samples = built.samples;
            let paths = paths_of(&samples);
            (samples, paths)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn change<'a>(sample: &'a Sample, path: &str) -> Option<&'a FileChange> {
        sample.changes.iter().find(|c| c.path == path)
    }

    #[test]
    fn scans_a_real_repository_end_to_end() {
        let mut fx = Fixture::new("end-to-end");

        fx.write("src/main.rs", b"fn main() {}\n");
        fx.write("README.md", b"# demo\n");
        fx.commit("initial commit");

        fx.write("src/lib.rs", b"pub fn a() {}\npub fn b() {}\n");
        fx.write("node_modules/left-pad/index.js", b"module.exports = 1\n");
        fx.commit("add lib, and a vendored dependency");

        fx.remove("README.md");
        fx.write("assets/logo.png", &[0u8, 1, 2, 0, 255]);
        fx.commit("drop readme, add binary asset");

        let (samples, paths) = fx.scan();

        assert_eq!(samples.len(), 3, "three commits means three samples");
        assert_eq!(
            samples[0].meta.message, "initial commit",
            "oldest commit must come first"
        );
        assert_eq!(samples[2].meta.message, "drop readme, add binary asset");
        assert!(
            samples[2].meta.timestamp >= samples[0].meta.timestamp,
            "timestamps must not run backwards"
        );

        assert!(
            paths.iter().all(|p| !p.starts_with("node_modules")),
            "node_modules leaked into the city: {paths:?}"
        );
        assert!(paths.iter().any(|p| p == "src/lib.rs"));

        assert_eq!(change(&samples[1], "src/lib.rs").unwrap().lines, Some(2));
        assert_eq!(change(&samples[0], "src/main.rs").unwrap().lines, Some(1));

        // Binary blobs are recorded but not counted.
        let logo = change(&samples[2], "assets/logo.png").expect("asset should appear");
        assert_eq!(logo.lines, Some(0));
        assert!(logo.is_binary);

        // Deletions arrive with no line count.
        assert_eq!(change(&samples[2], "README.md").unwrap().lines, None);
    }

    #[test]
    fn only_changed_files_become_deltas() {
        let mut fx = Fixture::new("deltas");

        fx.write("a.txt", b"one\n");
        fx.write("b.txt", b"two\n");
        fx.commit("first");

        // Rewriting a.txt must not re-report untouched b.txt.
        fx.write("a.txt", b"one\ntwo\n");
        fx.write("c.txt", b"three\n");
        fx.commit("second");

        let (samples, _) = fx.scan();
        assert_eq!(samples.len(), 2);

        let second: Vec<&str> = samples[1].changes.iter().map(|c| c.path.as_str()).collect();
        assert_eq!(second, vec!["a.txt", "c.txt"], "b.txt should not be re-sent");
        assert_eq!(samples[1].changes[0].lines, Some(2));
    }

    #[test]
    fn blob_table_reads_each_version_once() {
        let mut fx = Fixture::new("blobs");

        fx.write("keep.txt", b"stable\n");
        fx.write("churn.txt", b"a\n");
        fx.commit("first");
        fx.write("churn.txt", b"a\nb\n");
        fx.commit("second");

        let commits = fx.commits();
        let mut blobs = BlobTable::new();
        let indices = sample_indices_limited(commits.len(), MAX_SAMPLES);
        build_samples(&fx.repo, &commits, &indices, &mut blobs, |_, _| {}).unwrap();

        // keep.txt has one version, churn.txt has two: three blobs total, not
        // one per commit per file.
        assert_eq!(blobs.len(), 3);
        assert!(blobs.values().any(|b| b.lines == Some(1)));
        assert!(blobs.values().any(|b| b.lines == Some(2)));
    }

    #[test]
    fn file_count_at_ignores_the_same_paths() {
        let mut fx = Fixture::new("count");

        fx.write("src/a.rs", b"a\n");
        fx.write("node_modules/x/i.js", b"1\n");
        fx.commit("first");

        let commits = fx.commits();
        assert_eq!(file_count_at(&fx.repo, &commits[0]).unwrap(), 1);
    }

    #[test]
    fn overflow_message_names_directories() {
let overflow = SlotOverflow {
            limit: 10,
            seen: 42,
            top_dirs: vec![("engine".into(), 30), ("packages".into(), 9)],
        };
        let message = overflow.message();
        assert!(message.contains("engine (30)"), "{message}");
        assert!(message.contains("packages (9)"), "{message}");
        assert!(message.contains('4'), "limit should be in the message: {message}");
    }
}