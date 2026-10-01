import { invoke } from '@tauri-apps/api/core'
import type { ContributorRank, FetchRepoRequest, RepoSnapshot, Settings, Weights } from '../types'

const isTauri = () => typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)

export function normalizeRepository(provider: Settings['provider'], repository: string): string {
  const value = repository.trim()
  if (provider !== 'github' || !value) return value
  try {
    const url = new URL(value)
    if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return value
    const parts = url.pathname.split('/').filter(Boolean)
    return parts.length >= 2 ? `${parts[0]}/${parts[1].replace(/\.git$/, '')}` : value
  } catch {
    return value.replace(/^github\.com\//i, '').replace(/\.git\/?$/, '')
  }
}

const demoSnapshot: RepoSnapshot = {
  provider: 'github', repository: 'openai/example', fetchedAt: new Date().toISOString(),
  contributors: [
    { login: 'linh', name: 'Linh Nguyen', commits: 84, additions: 12450, deletions: 3120, prs: 21, mergedPrs: 18, closedIssues: 14, reviews: 77, timeline: [{ date: '2025-01-15', type: 'PR', title: 'Add streaming retry support' }, { date: '2025-02-02', type: 'Review', title: 'Review cache invalidation' }], trend: [{ date: 'Jan', additions: 2100, deletions: 340, commits: 20 }, { date: 'Feb', additions: 3400, deletions: 650, commits: 24 }, { date: 'Mar', additions: 4200, deletions: 980, commits: 26 }, { date: 'Apr', additions: 2750, deletions: 1150, commits: 14 }] },
    { login: 'marco', name: 'Marco Rossi', commits: 67, additions: 8430, deletions: 2210, prs: 17, mergedPrs: 15, closedIssues: 18, reviews: 42, timeline: [{ date: '2025-02-10', type: 'Issue', title: 'Close flaky test issue' }], trend: [{ date: 'Jan', additions: 1900, deletions: 420, commits: 17 }, { date: 'Feb', additions: 2100, deletions: 510, commits: 16 }, { date: 'Mar', additions: 2800, deletions: 620, commits: 20 }, { date: 'Apr', additions: 1630, deletions: 660, commits: 14 }] },
    { login: 'sana', name: 'Sana Patel', commits: 51, additions: 6790, deletions: 1750, prs: 12, mergedPrs: 11, closedIssues: 22, reviews: 58, timeline: [{ date: '2025-03-01', type: 'Commit', title: 'Improve contributor dashboard' }], trend: [{ date: 'Jan', additions: 1200, deletions: 280, commits: 12 }, { date: 'Feb', additions: 1700, deletions: 390, commits: 13 }, { date: 'Mar', additions: 2050, deletions: 510, commits: 15 }, { date: 'Apr', additions: 1840, deletions: 570, commits: 11 }] }
  ]
}

export async function greet(name: string) { return isTauri() ? invoke<string>('greet', { name }) : `你好，${name}！` }

export async function fetchRepoData(request: FetchRepoRequest): Promise<RepoSnapshot> {
  const normalizedRequest = { ...request, repository: normalizeRepository(request.provider, request.repository) }
  return isTauri() ? invoke<RepoSnapshot>('fetch_repo_data', { request: normalizedRequest }) : { ...demoSnapshot, provider: normalizedRequest.provider, repository: normalizedRequest.repository || demoSnapshot.repository, fetchedAt: new Date().toISOString() }
}

function localRank(snapshot: RepoSnapshot, weights: Weights): ContributorRank[] {
  const keys = ['commits', 'loc', 'prs', 'mergedPrs', 'closedIssues', 'reviews'] as const
  const max: Record<string, number> = {}
  for (const key of keys) max[key] = Math.max(...snapshot.contributors.map(c => key === 'loc' ? c.additions + c.deletions : c[key]), 1)
  return snapshot.contributors.map(c => ({ ...c, score: keys.reduce((sum, key) => sum + (key === 'loc' ? (c.additions + c.deletions) / max[key] : c[key] / max[key]) * weights[key], 0), rank: 0 }))
    .sort((a, b) => b.score - a.score).map((c, i) => ({ ...c, rank: i + 1 }))
}

export async function calculateRankings(snapshot: RepoSnapshot, weights: Weights): Promise<ContributorRank[]> {
  return isTauri() ? invoke<ContributorRank[]>('calculate_rankings', { snapshot, weights }) : localRank(snapshot, weights)
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (isTauri()) await invoke('save_settings', { settings })
  localStorage.setItem('contributor-rank-settings', JSON.stringify(settings))
}

export async function loadSettings(): Promise<Settings | null> {
  if (isTauri()) return invoke<Settings | null>('load_settings')
  const raw = localStorage.getItem('contributor-rank-settings')
  return raw ? JSON.parse(raw) : null
}
