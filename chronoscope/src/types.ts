// Wire types. Mirrors src-tauri/src/model.rs (serde camelCase).

export interface FileChange {
  path: string
  lang: string
  /** Line count; null means the path was deleted at this point. */
  lines: number | null
  isBinary: boolean
}

export interface CommitMeta {
  oid: string
  parents: string[]
  /** Unix seconds. */
  timestamp: number
  /** First line of the commit message. */
  message: string
  authorName: string
  authorEmail: string
}

/** A sampled commit plus the changes it introduced relative to the previous sample. */
export interface Sample extends CommitMeta {
  changes: FileChange[]
}

export interface ScanResult {
  repoName: string
  head: string
  commitCount: number
  firstTimestamp: number
  lastTimestamp: number
  /** Number of distinct file slots after ignore rules. */
  fileCount: number
  /** True when commits were strided down to fewer timeline stops. */
  strided: boolean
  samples: Sample[]
  /** Cache was reused because HEAD had not moved. */
  fromCache: boolean
}

export interface ScanProgress {
  phase: 'commits' | 'trees' | 'saving'
  done: number
  total: number
}