import { useEffect, useRef, useState } from 'react'
import type { FrameStats } from '../three/CityScene'
import { fmtInt } from '../format'

interface Props {
  /** Frame subscription from the render loop; returns an unsubscribe. */
  subscribe: (cb: (stats: FrameStats) => void) => () => void
  /** What the numbers are being measured against. */
  label: string
}

/** Overlay refresh. Frame times are already averaged over a second. */
const REPAINT_MS = 250

/**
 * Frame timing and renderer counters.
 *
 * Subscribes directly rather than routing through App state: at 60fps that
 * would re-render the whole tree — including the timeline canvas — sixty times
 * a second, which is precisely the cost being measured.
 */
export function Stats({ subscribe, label }: Props) {
  const [stats, setStats] = useState<FrameStats | null>(null)
  const lastPaint = useRef(0)

  useEffect(() => {
    return subscribe(s => {
      const now = performance.now()
      if (now - lastPaint.current < REPAINT_MS) return
      lastPaint.current = now
      setStats(s)
    })
  }, [subscribe])

  return (
    <div className="stats-overlay glass" aria-label="Render statistics">
      <div className="stats-title">{label}</div>
      <dl>
        <div>
          <dt>fps</dt>
          <dd className="mono">{stats ? stats.fps.toFixed(0) : '—'}</dd>
        </div>
        <div>
          <dt>frame</dt>
          <dd className="mono">{stats ? `${stats.frameMs.toFixed(1)} ms` : '—'}</dd>
        </div>
        <div>
          <dt>worst</dt>
          <dd className={stats && stats.worstMs > 33.4 ? 'mono warn' : 'mono'}>
            {stats ? `${stats.worstMs.toFixed(1)} ms` : '—'}
          </dd>
        </div>
        <div>
          <dt>blocks</dt>
          <dd className="mono">{stats ? fmtInt(stats.instances) : '—'}</dd>
        </div>
        <div>
          <dt>draws</dt>
          <dd className="mono">{stats ? fmtInt(stats.drawCalls) : '—'}</dd>
        </div>
        <div>
          <dt>tris</dt>
          <dd className="mono">{stats ? fmtInt(stats.triangles) : '—'}</dd>
        </div>
        <div>
          <dt>progs</dt>
          <dd className="mono">{stats ? fmtInt(stats.programs) : '—'}</dd>
        </div>
      </dl>
    </div>
  )
}