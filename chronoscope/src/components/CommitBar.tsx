import type { ReactNode } from 'react'
import type { Snapshot } from '../types'
import { fmtDateTime, fmtInt, shortSha } from '../format'

interface Props {
  repoName: string
  snapshot: Snapshot
  index: number
  count: number
  /** Rendered under the commit card in the left column (the legend). */
  children?: ReactNode
}

export function CommitBar({ repoName, snapshot, index, count, children }: Props) {
  let lines = 0
  for (const f of snapshot.files) lines += f.lines
  return (
    <header className="commitbar">
      <div className="hud-left">
        <div className="commit-card glass">
          <div className="commit-repo">
            <span className="brand">chronoscope</span>
            <span className="sep">/</span>
            <span>{repoName}</span>
          </div>
          <div className="commit-msg" title={snapshot.message}>{snapshot.message}</div>
          <div className="commit-meta">
            <span className="commit-sha mono">{shortSha(snapshot.commitOid)}</span>
            <span>{snapshot.authorName}</span>
            <span className="mono">{fmtDateTime(snapshot.timestamp)}</span>
          </div>
        </div>
        {children}
      </div>
      <div className="stats glass">
        <div className="stat">
          <div className="stat-value mono">{fmtInt(snapshot.files.length)}</div>
          <div className="stat-label">files</div>
        </div>
        <div className="stat">
          <div className="stat-value mono">{fmtInt(lines)}</div>
          <div className="stat-label">lines</div>
        </div>
        <div className="stat">
          <div className="stat-value mono">{index + 1}<span className="stat-of">/{count}</span></div>
          <div className="stat-label">commit</div>
        </div>
      </div>
    </header>
  )
}
