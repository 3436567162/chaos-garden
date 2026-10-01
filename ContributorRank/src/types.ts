export type MetricKey = 'commits' | 'loc' | 'prs' | 'mergedPrs' | 'closedIssues' | 'reviews'

export const metricLabels: Record<MetricKey, string> = {
  commits: 'Commit 提交', loc: '代码增删行数', prs: 'PR 创建', mergedPrs: 'PR 合并', closedIssues: 'Issue 关闭', reviews: 'Code Review 评论'
}

export type Weights = Record<MetricKey, number>

export interface ContributorMetrics {
  login: string
  name: string
  avatarUrl?: string
  commits: number
  additions: number
  deletions: number
  prs: number
  mergedPrs: number
  closedIssues: number
  reviews: number
  timeline: { date: string; type: string; title: string; url?: string }[]
  trend: { date: string; additions: number; deletions: number; commits: number }[]
}

export interface ContributorRank extends ContributorMetrics { score: number; rank: number }

export interface RepoSnapshot {
  provider: 'github' | 'gitlab' | 'local'
  repository: string
  fetchedAt: string
  contributors: ContributorMetrics[]
}

export interface Settings {
  provider: 'github' | 'gitlab' | 'local'
  repository: string
  token: string
  weights: Weights
}

export interface FetchRepoRequest { provider: Settings['provider']; repository: string; token?: string; forceRefresh?: boolean }
