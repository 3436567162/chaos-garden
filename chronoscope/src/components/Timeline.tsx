import { useCallback, useEffect, useMemo, useRef, type PointerEvent, type ReactNode } from 'react'
import type { Snapshot } from '../types'
import { fmtDate, fmtInt, shortSha } from '../format'

interface Props {
  snapshots: Snapshot[]
  index: number
  onChange: (index: number) => void
  controls?: ReactNode
}

const CHART_H = 46

function drawArea(canvas: HTMLCanvasElement, totals: number[], index: number) {
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

  const max = Math.max(1, ...totals)
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

  const future = g.createLinearGradient(0, 0, 0, h)
  future.addColorStop(0, 'rgba(140,150,220,0.22)')
  future.addColorStop(1, 'rgba(140,150,220,0.02)')
  g.fillStyle = future
  g.fill(path)

  const cut = px(index)
  g.save()
  g.beginPath()
  g.rect(0, 0, cut, h)
  g.clip()
  const past = g.createLinearGradient(0, 0, w, 0)
  past.addColorStop(0, 'rgba(90,169,255,0.55)')
  past.addColorStop(1, 'rgba(255,138,92,0.6)')
  g.fillStyle = past
  g.fill(path)
  g.restore()
}

export function Timeline({ snapshots, index, onChange, controls }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const last = Math.max(1, snapshots.length - 1)
  const pct = (i: number) => (snapshots.length <= 1 ? 50 : (i / last) * 100)

  const totals = useMemo(
    () => snapshots.map(s => s.files.reduce((n, f) => n + f.lines, 0)),
    [snapshots]
  )

  useEffect(() => {
    const c = canvasRef.current!
    drawArea(c, totals, index)
    const ro = new ResizeObserver(() => drawArea(c, totals, index))
    ro.observe(c)
    return () => ro.disconnect()
  }, [totals, index])

  const indexAt = useCallback(
    (clientX: number) => {
      const rect = trackRef.current!.getBoundingClientRect()
      const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return Math.round(t * last)
    },
    [last]
  )

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    onChange(indexAt(e.clientX))
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) onChange(indexAt(e.clientX))
  }

  const current = snapshots[index]
  const first = snapshots[0]
  const end = snapshots[snapshots.length - 1]

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
          aria-valuemax={snapshots.length - 1}
          aria-valuenow={index}
          aria-valuetext={current ? `${shortSha(current.commitOid)} ${current.message}` : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
        >
          <canvas ref={canvasRef} className="timeline-chart" style={{ height: CHART_H }} />
          <div className="timeline-axis">
            {snapshots.map((s, i) => (
              <div
                key={s.commitOid}
                className={i <= index ? 'timeline-tick past' : 'timeline-tick'}
                style={{ left: `${pct(i)}%` }}
              />
            ))}
          </div>
          <div className="timeline-handle" style={{ left: `${pct(index)}%` }}>
            <div className="timeline-flag mono" style={{ transform: `translateX(-${pct(index)}%)` }}>
              {current ? `${shortSha(current.commitOid)} · ${fmtInt(totals[index])} lines` : ''}
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
