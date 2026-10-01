import { create } from 'zustand'
import type { ContributorRank, RepoSnapshot, Settings, Weights } from '../types'
import { calculateRankings, fetchRepoData, loadSettings, normalizeRepository, saveSettings } from '../lib/tauri'

const defaultWeights: Weights = { commits: 1, loc: 0.7, prs: 1, mergedPrs: 1.2, closedIssues: 0.8, reviews: 0.9 }
const defaultSettings: Settings = { provider: 'github', repository: '', token: '', weights: defaultWeights }

interface AppState {
  settings: Settings; snapshot: RepoSnapshot | null; rankings: ContributorRank[]; loading: boolean; error: string | null; view: 'table' | 'cards'
  setSettings: (patch: Partial<Settings>) => void; setWeight: (key: keyof Weights, value: number) => void; setView: (view: 'table' | 'cards') => void
  refresh: () => Promise<void>; recalculate: () => Promise<void>; persistSettings: () => Promise<void>; hydrate: () => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: defaultSettings, snapshot: null, rankings: [], loading: false, error: null, view: 'table',
  setSettings: patch => set(state => ({ settings: { ...state.settings, ...patch } })),
  setWeight: (key, value) => set(state => ({ settings: { ...state.settings, weights: { ...state.settings.weights, [key]: value } } })),
  setView: view => set({ view }),
  refresh: async () => {
    if (get().loading) return
    if (!get().settings.repository.trim()) { set({ snapshot: null, rankings: [], error: null, loading: false }); return }
    set({ loading: true, error: null })
    try {
      const settings = get().settings
      const repository = normalizeRepository(settings.provider, settings.repository)
      if (repository !== settings.repository) set({ settings: { ...settings, repository } })
      const snapshot = await fetchRepoData({ ...settings, repository, forceRefresh: true })
      const rankings = await calculateRankings(snapshot, get().settings.weights)
      set({ snapshot, rankings })
    }
    catch (error) { set({ error: error instanceof Error ? error.message : String(error) }) }
    finally { set({ loading: false }) }
  },
  recalculate: async () => { const snapshot = get().snapshot; if (!snapshot) return; set({ loading: true }); try { set({ rankings: await calculateRankings(snapshot, get().settings.weights) }) } finally { set({ loading: false }) } },
  persistSettings: async () => { await saveSettings(get().settings) },
  hydrate: async () => { const saved = await loadSettings(); if (saved) set({ settings: saved }) }
}))
