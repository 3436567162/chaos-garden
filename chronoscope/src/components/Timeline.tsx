import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
  type PointerEvent,
  type ReactNode
} from 'react'
import type { CommitMeta } from '../types'
import { fmtDate, fmtInt, shortSha } from '../format'

interface Props {
  samples: CommitMeta[]
  /** Total lines per sample, driving the area chart. */
  totals: Int32Array
  /** Integer stop index; drives the readouts and the tick highlight. */
  index: number
  /** Candidate interval to band, while a search is running. */
  band?: [number, number] | null
  /** Row the search settled on. */
  culprit?: number | null
  /** Continuous playback position. The playhead tracks this, not `index`. */
  positionRef: MutableRefObject<number>
  /** Frame subscription from the render loop; returns an unsubscribe. */
  subscribe: (cb: (dt: number) => void) => () => void
  /** Fractional position along the track; the caller decides how to quantise it. */
  onChange: (position: number) => void
  controls?: ReactNode
}

const CHART_H = 46

/**
 * The area chart is two stacked canvases: a static "future" layer and a "past"
 * layer revealed by a CSS clip. Moving the playhead then costs one style write
 * per frame instead of a full path redraw.
 */
function drawLayer(canvas: HTMLCanvasElement, totals: ArrayLike<number>, layer: 'future' | 'past') {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (w === 0) return
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const g = canvas.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  if (totals.length === 0) return

  const max = Math.max(1, ...Array.from(totals))
  const last = Math.max(1, totals.length - 1)
  const px = (i: number) => (totals.length <= 1 ? w / 2 : (i / last) * w)
  const py = (v: number) => h - 2 - (v / max) * (h - 6)

  const path = new Path2D()
  path.moveTo(0, h)
  path.lineTo(px(0), py(totals[0]))
  // Monotone-ish smoothing with midpoint quadratic curves.
  for (let i = 1; i < totals.length; i++) {
    const mx = (px(i - 1) + px(i)) / 2
    path.quadraticCurveTo(px(i - 1), py(totals[i - 1]), mx, (py(totals[i - 1]) + py(totals[i])) / 2)
  }
  path.lineTo(px(last), py(totals[last]))
  path.lineTo(w, h)
  path.closePath()

  const grad =
    layer === 'future'
      ? g.createLinearGradient(0, 0, 0, h)
      : g.createLinearGradient(0, 0, w, 0)
  if (layer === 'future') {
    grad.addColorStop(0, 'rgba(140,150,220,0.22)')
    grad.addColorStop(1, 'rgba(140,150,220,0.02)')
  } else {
    grad.addColorStop(0, 'rgba(90,169,255,0.55)')
    grad.addColorStop(1, 'rgba(255,138,92,0.6)')
  }
  g.fillStyle = grad
  g.fill(path)
}

export function Timeline({
  samples,
  totals,
  index,
  band,
  culprit,
  positionRef,
  subscribe,
  onChange,
  controls
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const pastRef = useRef<HTMLCanvasElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const flagRef = useRef<HTMLDivElement>(null)
  const last = Math.max(1, samples.length - 1)
  const pctOf = (p: number) => (samples.length <= 1 ? 50 : (p / last) * 100)

  useEffect(() => {
    const future = trackRef.current?.querySelector<HTMLCanvasElement>('.timeline-chart-future')
    const past = pastRef.current
    if (!future || !past) return
    const redraw = () => {
      drawLayer(future, totals, 'future')
      drawLayer(past, totals, 'past')
    }
    redraw()
    const ro = new ResizeObserver(redraw)
    ro.observe(future)
    return () => ro.disconnect()
  }, [totals])

  // Playhead, chart clip and flag all follow the fractional position, so the
  // whole strip glides at frame rate instead of hopping commit to commit.
  //
  // Layout effect, and the JSX carries no inline `left` on these nodes: React
  // would otherwise rewrite the imperative style on every re-render and yank
  // the playhead back to the integer index once per commit.
  useLayoutEffect(() => {
    const track = trackRef.current
    const past = pastRef.current
    const handle = handleRef.current
    const flag = flagRef.current
    if (!track || !past || !handle || !flag) return

    const place = (p: number) => {
      const pct = pctOf(p)
      handle.style.left = `${pct}%`
      past.style.clipPath = `inset(0 ${(100 - pct).toFixed(3)}% 0 0)`
      // Keep the flag fully on screen without letting it jitter per commit.
      const tw = track.clientWidth
      const fw = flag.offsetWidth
      if (tw > 0 && fw > 0) {
        const centre = (pct / 100) * tw
        const left = Math.min(Math.max(centre - fw / 2, 0), tw - fw)
        flag.style.left = `${left - centre + 1}px`
      }
    }

    let shown = Number.NaN
    place(positionRef.current)
    const unsubscribe = subscribe(() => {
      const p = positionRef.current
      if (p === shown) return
      shown = p
      place(p)
    })
    const ro = new ResizeObserver(() => {
      shown = Number.NaN
      place(positionRef.current)
    })
    ro.observe(track)
    return () => {
      unsubscribe()
      ro.disconnect()
    }
  }, [subscribe, positionRef, samples.length])

  /** Fractional position, so a click can park between two commits. */
  const positionAt = useCallback(
    (clientX: number) => {
      const rect = trackRef.current!.getBoundingClientRect()
      if (rect.width === 0) return 0
      const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return t * last
    },
    [last]
  )

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    onChange(positionAt(e.clientX))
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) onChange(positionAt(e.clientX))
  }

  const current = samples[index]
  const first = samples[0]
  const end = samples[samples.length - 1]

  return (
    <footer className="timeline glass">
      {controls}
      <div className="timeline-main">
        <div
          ref={trackRef}
          className="timeline-track"
          role="slider"
          tabIndex={0}
          aria-label="Commit timeline"
          aria-valuemin={0}
          aria-valuemax={samples.length - 1}
          aria-valuenow={index}
          aria-valuetext={current ? `${shortSha(current.oid)} ${current.message}` : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
        >
          <canvas
            className="timeline-chart timeline-chart-future"
            style={{ height: CHART_H }}
          />
          <canvas
            ref={pastRef}
            className="timeline-chart timeline-chart-past"
            style={{ height: CHART_H }}
          />
          <div className="timeline-axis">
            {band ? (
              <div
                className="timeline-band"
                style={{
                  left: `${pctOf(band[0])}%`,
                  width: `${pctOf(band[1]) - pctOf(band[0])}%`
                }}
              />
            ) : null}
            {samples.map((s, i) => (
              <div
                key={s.oid}
                className={
                  culprit === i
                    ? 'timeline-tick culprit'
                    : band && (i < band[0] || i > band[1])
                      ? 'timeline-tick dropped'
                      : i <= index
                        ? 'timeline-tick past'
                        : 'timeline-tick'
                }
                style={{ left: `${pctOf(i)}%` }}
              />
            ))}
          </div>
          <div ref={handleRef} className="timeline-handle">
            <div ref={flagRef} className="timeline-flag mono">
              {current ? `${shortSha(current.oid)} 路 ${fmtInt(totals[index])} lines` : ''}
            </div>
          </div>
        </div>
        <div className="timeline-scale mono">
          <span>{first ? fmtDate(first.timestamp) : ''}</span>
          <span>{end ? fmtDate(end.timestamp) : ''}</span>
        </div>
      </div>
    </footer>
  )
}