// Mirrors src-tauri/src/model.rs (serde camelCase).

export interface FileEntry {
  /** Repository-relative path, posix separators. */
  path: string
  blobOid: string
  lang: string
  /** Line count; 0 for empty or binary files. */
  lines: number
  isBinary: boolean
}

export interface Snapshot {
  commitOid: string
  parents: string[]
  /** Unix seconds. */
  timestamp: number
  /** First line of the commit message. */
  message: string
  authorName: string
  authorEmail: string
  files: FileEntry[]
}

export interface Timeline {
  repoName: string
  /** Oldest first. */
  snapshots: Snapshot[]
}
