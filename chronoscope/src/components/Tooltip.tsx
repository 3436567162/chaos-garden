import { useEffect, useRef } from 'react'
import type { History } from '../history'
import type { Pick } from '../three/CityScene'
import { fmtInt } from '../format'

interface Props {
  history: History
  /** Sample row the readouts are showing. */
  row: number
  pick: Pick | null
}

/** Follows the cursor over the city; disappears when nothing is under it. */
export function Tooltip({ history, row, pick }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // Position is written straight to the node: the tooltip tracks the pointer
  // every frame, and re-rendering the app for that would be wasteful.
  useEffect(() => {
    const el = ref.current
    if (!el || !pick) return
    const pad = 14
    const w = el.offsetWidth
    const h = el.offsetHeight
    const flipX = pick.clientX + pad + w > window.innerWidth
    const left = flipX ? pick.clientX - pad - w : pick.clientX + pad
    const top = Math.min(pick.clientY + pad, window.innerHeight - h - pad)
    el.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`
  }, [pick])

  if (!pick) return null

  const path = history.pathAt(pick.slot)
  const exists = history.existsAt(row, pick.slot)
  const lang = history.langAt(row, pick.slot)
  const lines = history.linesAt(row, pick.slot)

  return (
    <div className="tooltip glass" ref={ref} role="tooltip">
      <div className="tooltip-path mono" title={path}>
        {path}
      </div>
      {exists ? (
        <div className="tooltip-meta">
          {lang && <span>{lang}</span>}
          <span className="mono">{fmtInt(lines)} lines</span>
        </div>
      ) : (
        <div className="tooltip-meta tooltip-absent">此commit 中不存在</div>
      )}
    </div>
  )
}