import type { ReactNode } from 'react'
import type { CommitMeta } from '../types'
import { fmtDateTime, fmtInt, shortSha } from '../format'

interface Props {
  repoName: string
  sample: CommitMeta
  files: number
  lines: number
  index: number
  count: number
  /** Rendered under the commit card in the left column (the legend). */
  children?: ReactNode
}

export function CommitBar({ repoName, sample, files, lines, index, count, children }: Props) {
  return (
    <header className="commitbar">
      <div className="hud-left">
        <div className="commit-card glass">
          <div className="commit-repo">
            <span className="brand">chronoscope</span>
            <span className="sep">/</span>
            <span>{repoName}</span>
          </div>
          <div className="commit-msg" title={sample.message}>
            {sample.message}
          </div>
          <div className="commit-meta">
            <span className="commit-sha mono">{shortSha(sample.oid)}</span>
            <span>{sample.authorName}</span>
            <span className="mono">{fmtDateTime(sample.timestamp)}</span>
          </div>
        </div>
        {children}
      </div>
      <div className="stats glass">
        <div className="stat">
          <div className="stat-value mono">{fmtInt(files)}</div>
          <div className="stat-label">files</div>
        </div>
        <div className="stat">
          <div className="stat-value mono">{fmtInt(lines)}</div>
          <div className="stat-label">lines</div>
        </div>
        <div className="stat">
          <div className="stat-value mono">
            {fmtInt(index + 1)}
            <span className="stat-of">/{fmtInt(count)}</span>
          </div>
          <div className="stat-label">commit</div>
        </div>
      </div>
    </header>
  )
}