import { useMemo } from 'react'
import type { History } from '../history'
import { langColor } from '../three/palette'

const MAX_ROWS = 8

interface Props {
  history: History
  row: number
}

export function Legend({ history, row }: Props) {
  const rows = useMemo(() => history.langSlice(row, MAX_ROWS), [history, row])

  if (rows.length === 0) return null

  return (
    <aside className="legend glass" aria-label="Languages by line count">
      <div className="legend-bar">
        {rows.map(r => (
          <span key={r.lang} style={{ flexGrow: r.share, background: langColor(r.lang) }} />
        ))}
      </div>
      {rows.map(r => (
        <div key={r.lang} className="legend-row">
          <span
            className="legend-swatch"
            style={{ background: langColor(r.lang), color: langColor(r.lang) }}
          />
          <span className="legend-lang">{r.lang}</span>
          <span className="legend-share mono">{(r.share * 100).toFixed(1)}%</span>
        </div>
      ))}
    </aside>
  )
}