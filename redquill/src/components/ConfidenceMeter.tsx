import { verdictColor } from '../palette'

/**
 * Confidence bar. Colour follows the verdict, and the number is always printed
 * next to it — a bar alone hides the difference between 0.55 and 0.95, which is
 * exactly the difference this tool exists to preserve.
 */
export function ConfidenceMeter({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className="meter" title={`${label} ${(value * 100).toFixed(0)}%`}>
      <div style={{ width: `${pct}%`, background: verdictColor[label] ?? '#7c8494' }} />
    </div>
  )
}