// Thin wrappers over the Rust commands. Kept in one place so the rest of the app
// never touches `@tauri-apps/api` directly and can be unit-tested or stubbed.

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import type { ScanProgress, ScanResult } from './types'

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Opens a folder picker. Resolves to null when the user cancels. */
export async function pickFolder(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, title: '选择一个 Git 仓库' })
  return typeof picked === 'string' ? picked : null
}

/**
 * Scans a local repository. Rejects with a plain string message, which is what
 * the Rust command serialises its errors to.
 */
export function scanRepository(path: string): Promise<ScanResult> {
  return invoke<ScanResult>('scan_repository', { path })
}

/** Subscribes to scan progress; resolves to an unsubscribe function. */
export async function onScanProgress(
  handler: (progress: ScanProgress) => void
): Promise<UnlistenFn> {
  return listen<ScanProgress>('scan-progress', event => handler(event.payload))
}

/** Turns a rejected command into a message fit for the UI. */
export function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Appends a line to the app's `bench.log`. Only registered in debug builds, so
 * calling it in a release app rejects; the caller ignores that.
 */
export function writeBenchLog(line: string): void {
  void invoke('write_bench_log', { line }).catch(() => {})
}