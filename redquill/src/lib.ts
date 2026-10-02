// Thin wrappers over the Rust commands. Kept in one place so the rest of the app
// never touches `@tauri-apps/api` directly and can be stubbed in a browser.

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  Endpoint,
  FamilyInfo,
  RunSummary,
  ScanConfig,
  ScanFinished,
  ScanProgress,
  ScanResult
} from './types'

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Lists the bundled attack families. */
export function listFamilies(): Promise<FamilyInfo[]> {
  return invoke<FamilyInfo[]>('list_families')
}

/** One tiny completion against the endpoint, to verify it is reachable. */
export function testEndpoint(endpoint: Endpoint): Promise<string> {
  return invoke<string>('test_endpoint', { endpoint })
}

/** Model ids from `/models`, for the picker. Empty is normal for some servers. */
export function listModels(endpoint: Endpoint): Promise<string[]> {
  return invoke<string[]>('list_models', { endpoint })
}

/** Starts a run and returns its cancellation key. Progress arrives by event. */
export function startScan(config: ScanConfig): Promise<string> {
  return invoke<string>('start_scan', { config })
}

export function cancelScan(runKey: string): Promise<void> {
  return invoke<void>('cancel_scan', { runKey })
}

export function listRuns(): Promise<RunSummary[]> {
  return invoke<RunSummary[]>('list_runs')
}

export function loadRun(runId: string): Promise<ScanResult> {
  return invoke<ScanResult>('load_run', { runId })
}

export function deleteRun(runId: string): Promise<void> {
  return invoke<void>('delete_run', { runId })
}

export function exportRun(runId: string, destination: string): Promise<void> {
  return invoke<void>('export_run', { runId, destination })
}

export function suggestSeed(): Promise<number> {
  return invoke<number>('suggest_seed')
}

export function onScanProgress(
  handler: (progress: ScanProgress) => void
): Promise<UnlistenFn> {
  return listen<ScanProgress>('scan-progress', event => handler(event.payload))
}

export function onScanFinished(
  handler: (payload: ScanFinished) => void
): Promise<UnlistenFn> {
  return listen<ScanFinished>('scan-finished', event => handler(event.payload))
}

/** Turns a rejected command into a message fit for the UI. */
export function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Browser-only stand-in so `npm run dev` in a plain browser shows the shell
 * instead of throwing on every command. Returns zeroed data rather than a
 * plausible-looking run: a fake that looks real is worse than an empty one.
 */
export const demo: Record<string, () => Promise<unknown>> = {
  list_families: () =>
    Promise.resolve([
      { id: 'direct', name: '直接请求', summary: '裸请求基线', multiTurn: false }
    ]),
  list_models: () => Promise.resolve([]),
  test_endpoint: () => Promise.reject('preview build: no network calls'),
  start_scan: () => Promise.reject('preview build: run from the desktop app'),
  list_runs: () => Promise.resolve([]),
  suggest_seed: () => Promise.resolve(42)
}