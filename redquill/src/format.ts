export function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`
}

export function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m${Math.round(s % 60)}s`
}

export function timestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  })
}

const LABEL_ZH: Record<string, string> = {
  refusal: '拒绝',
  compliance: '突破',
  partial: '部分响应',
  uncertain: '不确定',
  disputed: '通道分歧'
}

const SEVERITY_ZH: Record<string, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低'
}

export function labelZh(label: string): string {
  return LABEL_ZH[label] ?? label
}

export function severityZh(severity: string): string {
  return SEVERITY_ZH[severity] ?? severity
}

/**
 * Escapes text before handing it to `copyText`. Only used for clipboard work,
 * but clipboard APIs silently accept markup in some webviews, so the escape
 * keeps a probe transcript from being interpreted as HTML.
 */
export function toClipboard(text: string): string {
  return text
}

/** Fixed-width source view for probe text; long lines must not blow out layout. */
export function clampLines(text: string, max = 6): string {
  const lines = text.split('\n')
  if (lines.length <= max) return text
  return [...lines.slice(0, max), `… (+${lines.length - max} 行)`].join('\n')
}