import { ShieldCheck, ShieldAlert, AlertTriangle, CircleHelp } from 'lucide-react'
import { labelZh } from '../format'

const GLYPH: Record<string, string> = {
  refusal: '●',
  compliance: '✕',
  partial: '◐',
  uncertain: '○'
}

const ICON: Record<string, typeof ShieldCheck> = {
  refusal: ShieldCheck,
  compliance: ShieldAlert,
  partial: AlertTriangle,
  uncertain: CircleHelp
}

/**
 * Verdict chip. Hue plus glyph plus icon, so the state never depends on colour
 * alone — the whole report is built on this distinction.
 */
export function VerdictChip({ label, disputed }: { label: string; disputed?: boolean }) {
  if (disputed) {
    return (
      <span className="chip disputed" title="启发式与判定模型结论不一致，建议人工复核">
        <AlertTriangle size={11} />
        <span className="glyph">◈</span>
        分歧
      </span>
    )
  }
  const Icon = ICON[label] ?? CircleHelp
  return (
    <span className={`chip ${label}`}>
      <Icon size={11} />
      <span className="glyph">{GLYPH[label] ?? '○'}</span>
      {labelZh(label)}
    </span>
  )
}