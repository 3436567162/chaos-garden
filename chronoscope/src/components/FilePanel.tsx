import { useEffect, useMemo, useRef } from 'react'
import type { History } from '../history'
import { fmtDateTime, fmtInt, shortSha } from '../format'
import { langColor } from '../three/palette'

interface Props {
  history: History
  slot: number
  /** Sample row currently shown, highlighted in the revision list. */
  row: number
  onPickRow: (row: number) => void
  onClose: () => void
}

/**
 * Everything known about one file: where it stands now, and every point where
 * its content changed. Clicking a revision jumps the timeline there.
 */
export function FilePanel({ history, slot, row, onPickRow, onClose }: Props) {
  const listRef = useRef<HTMLOListElement>(null)
  const path = history.pathAt(slot)
  const exists = history.existsAt(row, slot)
  const lang = history.langAt(row, slot)
  const lines = history.linesAt(row, slot)

  const revisions = useMemo(() => history.fileHistory(slot), [history, slot])

  useEffect(() => {
    const active = listRef.current?.querySelector('.revision.current')
    active?.scrollIntoView({ block: 'nearest' })
  }, [row, revisions])

  const live = revisions.filter(r => !r.deleted)
  const first = live[0]
  const lastChanged = live[live.length - 1]
  const touchCount = live.length

  return (
    <aside className="filepanel glass" aria-label="File detail">
      <header className="filepanel-head">
        <div className="filepanel-path mono" title={path}>
          {path}
        </div>
        <button type="button" className="filepanel-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </header>

      <dl className="filepanel-stats">
        <div>
          <dt>当前</dt>
          <dd>
            {exists ? (
              <>
                <span
                  className="dot"
                  style={{ background: langColor(lang || 'Unknown') }}
                  aria-hidden="true"
                />
                {exists ? `${lang || 'Unknown'} · ` : ''}
                <span className="mono">{fmtInt(lines)}</span> 行
              </>
            ) : (
              '此 commit 中不存在'
            )}
          </dd>
        </div>
        <div>
          <dt>改动次数</dt>
          <dd className="mono">{fmtInt(touchCount)}</dd>
        </div>
        {first ? (
          <div>
            <dt>首次出现</dt>
            <dd className="mono">
              {shortSha(history.samples[first.row].oid)} ·{' '}
              {fmtDateTime(history.samples[first.row].timestamp)}
            </dd>
          </div>
        ) : null}
        {lastChanged ? (
          <div>
            <dt>最后改动</dt>
            <dd className="mono">
              {shortSha(history.samples[lastChanged.row].oid)} ·{' '}
              {fmtDateTime(history.samples[lastChanged.row].timestamp)}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="filepanel-subtitle">修改史</div>
      {revisions.length === 0 ? (
        <p className="filepanel-empty">这个文件在当前时间轴上没有出现过。</p>
      ) : (
        <ol className="revision-list" ref={listRef}>
          {revisions
            .slice()
            .reverse()
            .map(rev => {
              const sample = history.samples[rev.row]
              return (
                <li
                  key={`${rev.row}-${rev.deleted ? 'del' : 'set'}`}
                  className={
                    rev.row === row ? 'revision current' : 'revision'
                  }
                >
                  <button type="button" onClick={() => onPickRow(rev.row)}>
                    <span className="revision-when mono">
                      {fmtDateTime(sample.timestamp)}
                    </span>
                    <span className="revision-msg" title={sample.message}>
                      {sample.message}
                    </span>
                    <span className="revision-tag">
                      {rev.deleted ? (
                        <span className="tag-deleted">删除</span>
                      ) : (
                        <>
                          <span className="mono">{fmtInt(rev.lines)}</span>
                          {rev.delta !== null && rev.delta !== 0 ? (
                            <span className={rev.delta > 0 ? 'delta-up' : 'delta-down'}>
                              {rev.delta > 0 ? '+' : ''}
                              {fmtInt(rev.delta)}
                            </span>
                          ) : null}
                        </>
                      )}
                    </span>
                    <span className="revision-who">{sample.authorName}</span>
                  </button>
                </li>
              )
            })}
        </ol>
      )}
    </aside>
  )
}