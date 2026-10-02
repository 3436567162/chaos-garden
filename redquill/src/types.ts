// Wire types. Mirrors src-tauri/src/model.rs (serde camelCase).

export type VerdictLabel = 'refusal' | 'compliance' | 'partial' | 'uncertain'
export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface Message {
  role: string
  content: string
}

/** Any OpenAI-compatible /v1/chat/completions endpoint. */
export interface Endpoint {
  baseUrl: string
  apiKey: string
  model: string
  temperature?: number | null
  maxTokens?: number | null
  timeoutSecs: number
  extraHeaders: [string, string][]
}

export interface JudgeConfig {
  enabled: boolean
  /** Independent judge endpoint; null reuses the target. */
  endpoint: Endpoint | null
  votes: number
  requireConsensus: boolean
  cacheVerdicts: boolean
}

export interface ScanConfig {
  objective: string
  target: Endpoint
  judge: JudgeConfig
  families: string[]
  population: number
  generations: number
  concurrency: number
  seed: number
  systemPrompt?: string | null
  /** Gate: the operator must confirm the target is theirs or authorised. */
  authorised: boolean
  rewriter?: Endpoint | null
}

export interface HeuristicVerdict {
  label: VerdictLabel
  score: number
  signals: string[]
  evasionMarkers: string[]
}

export interface JudgeVote {
  label: VerdictLabel
  score: number
  reason: string
}

export interface Verdict {
  label: VerdictLabel
  confidence: number
  agreement: number
  voteConsensus: number
  heuristic: HeuristicVerdict
  votes: JudgeVote[]
  disputed: boolean
}

export interface Attempt {
  probeId: string
  family: string
  operators: string[]
  prompt: string
  messages: Message[]
  /** Verbatim target output, so any finding is reproducible. */
  response: string
  verdict: Verdict
  latencyMs: number
  generation: number
  rewritten: boolean
  fitness: number
  error?: string | null
  promptTokens?: number | null
  completionTokens?: number | null
}

export interface FamilyStat {
  family: string
  attempts: number
  breaks: number
  refusals: number
  partial: number
  uncertain: number
  errors: number
  successRate: number
  meanFitness: number
}

export interface Finding {
  severity: Severity
  title: string
  detail: string
  recommendation: string
  evidence: string[]
  families: string[]
}

export interface ScanResult {
  runId: string
  startedAt: string
  finishedAt: string
  targetModel: string
  judgeModel: string
  totalAttempts: number
  totalBreaks: number
  overallSuccessRate: number
  generations: number
  elapsedMs: number
  familyStats: FamilyStat[]
  attempts: Attempt[]
  findings: Finding[]
  seed: number
  totalTokens: number
}

export interface ScanProgress {
  runId: string
  done: number
  total: number
  breaks: number
  generation: number
  totalGenerations: number
  bestFitness: number
  latest: Attempt | null
  phase: 'probing' | 'evolving' | 'cancelled' | string
}

export interface RunSummary {
  runId: string
  startedAt: string
  finishedAt: string
  targetModel: string
  totalAttempts: number
  totalBreaks: number
  overallSuccessRate: number
  seed: number
}

export interface FamilyInfo {
  id: string
  name: string
  summary: string
  multiTurn: boolean
}

/** `scan-finished` carries either a result or an error. */
export type ScanFinished = ScanResult | { error: string }

export function isErrorPayload(payload: ScanFinished): payload is { error: string } {
  return 'error' in payload
}