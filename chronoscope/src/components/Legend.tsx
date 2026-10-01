import { useMemo } from 'react'
import type { Snapshot } from '../types'
import { langColor } from '../three/palette'

const MAX_ROWS = 8

export function Legend({ snapshot }: { snapshot: Snapshot }) {
  const rows = useMemo(() => {
    const byLang = new Map<string, number>()
    let total = 0
    for (const f of snapshot.files) {
      if (f.isBinary || f.lines === 0) continue
      byLang.set(f.lang, (byLang.get(f.lang) ?? 0) + f.lines)
      total += f.lines
    }
    return Array.from(byLang, ([lang, lines]) => ({ lang, lines, share: total ? lines / total : 0 }))
      .sort((a, b) => b.lines - a.lines)
      .slice(0, MAX_ROWS)
  }, [snapshot])

  return (
    <aside className="legend glass" aria-label="Languages by line count">
      <div className="legend-bar">
        {rows.map(r => (
          <span key={r.lang} style={{ flexGrow: r.share, background: langColor(r.lang) }} />
        ))}
      </div>
      {rows.map(r => (
        <div key={r.lang} className="legend-row">
          <span className="legend-swatch" style={{ background: langColor(r.lang), color: langColor(r.lang) }} />
          <span className="legend-lang">{r.lang}</span>
          <span className="legend-share mono">{(r.share * 100).toFixed(1)}%</span>
        </div>
      ))}
    </aside>
  )
}
