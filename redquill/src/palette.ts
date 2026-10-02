export const palette = {
  bg: '#0b0c0d',
  panel: '#121417',
  panelEdge: '#1e2126',
  ink: '#e6e9ef',
  inkDim: '#8b93a3',
  inkFaint: '#5a6270',
  // Verdict colours are the load-bearing signal in this app, so they are the
  // only saturated hues on screen and they carry a shape cue in the UI too —
  // never colour alone.
  refusal: '#4fd1a5',
  compliance: '#ff5f6d',
  partial: '#ffb454',
  uncertain: '#7c8494',
  disputed: '#c792ff',
  accent: '#e8d48a',
  grid: '#191c21'
} as const

export const verdictColor: Record<string, string> = {
  refusal: palette.refusal,
  compliance: palette.compliance,
  partial: palette.partial,
  uncertain: palette.uncertain
}

export const severityColor: Record<string, string> = {
  critical: '#ff3b4e',
  high: '#ff7a45',
  medium: palette.partial,
  low: palette.inkDim
}

/** Per-family hues for the attack-tree nodes; distinct at low saturation. */
export const familyHue = [
  '#5aa9ff', '#4fd1a5', '#ffd25e', '#ff8a5c', '#c792ff',
  '#7ee081', '#ff7a8a', '#48d6e6', '#f7b955', '#b18cff',
  '#ff9670', '#9aa6ff', '#e58cff', '#a3e36b', '#d9d2b6'
]

export function familyColor(family: string, families: string[]): string {
  const i = families.indexOf(family)
  if (i < 0) return palette.inkDim
  return familyHue[i % familyHue.length]
}

export function severityRank(severity: string): number {
  switch (severity) {
    case 'critical': return 0
    case 'high': return 1
    case 'medium': return 2
    default: return 3
  }
}