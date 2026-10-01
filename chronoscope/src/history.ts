// Turns a ScanResult into everything the renderer needs.
//
// The backend sends only what changed at each sample, so the full grid is
// rebuilt here by replaying deltas into two flat Int32Arrays of shape
// `samples × slots`. That keeps the city in typed arrays instead of millions of
// JS objects, which is what makes a 200-sample timeline over a large repository
// affordable.

import type { CommitMeta, ScanResult } from './types'
import { computeLayout, type Layout } from './three/layout'
import { STRIDE, footprintFor, heightFor } from './three/morph'
import { LANG_NAMES, LANG_RGB, langIndex } from './three/palette'

/** Slot absent marker; every real language index is >= 0. */
const ABSENT = -1

export interface LangSlice {
  lang: string
  lines: number
  share: number
}

export class History {
  readonly repoName: string
  readonly head: string
  readonly commitCount: number
  readonly firstTimestamp: number
  readonly lastTimestamp: number
  readonly strided: boolean
  readonly fromCache: boolean
  /** Timeline stops, oldest first. */
  readonly samples: CommitMeta[]
  readonly layout: Layout
  /** Number of city slots (paths across the whole history). */
  readonly slots: number
  /** Total lines per sample, for the area chart and the readout. */
  readonly totals: Int32Array
  /** File count per sample, for the readout. */
  readonly fileCounts: Int32Array

  private readonly lines: Int32Array
  private readonly langs: Int32Array

  constructor(result: ScanResult) {
    this.repoName = result.repoName
    this.head = result.head
    this.commitCount = result.commitCount
    this.firstTimestamp = result.firstTimestamp
    this.lastTimestamp = result.lastTimestamp
    this.strided = result.strided
    this.fromCache = result.fromCache
    this.samples = result.samples.map(({ changes: _changes, ...meta }) => meta)

    // Pass one: which paths ever existed. The layout must be known before any
    // slot can be filled, so this cannot be merged with the replay below.
    const seen = new Set<string>()
    for (const sample of result.samples) {
      for (const change of sample.changes) {
        if (change.lines !== null) seen.add(change.path)
      }
    }
    this.layout = computeLayout(seen)

    const count = this.samples.length
    this.slots = this.layout.paths.length
    this.lines = new Int32Array(count * this.slots)
    this.langs = new Int32Array(count * this.slots).fill(ABSENT)
    this.totals = new Int32Array(count)
    this.fileCounts = new Int32Array(count)

    // Pass two: deltas are relative to the previous sample, so replay them
    // forward through a running state and snapshot that state into each row.
    const curLines = new Int32Array(this.slots)
    const curLangs = new Int32Array(this.slots).fill(ABSENT)
    for (let row = 0; row < count; row++) {
      for (const change of result.samples[row].changes) {
        const slot = this.layout.slotOf.get(change.path)
        if (slot === undefined) continue
        if (change.lines === null) {
          curLines[slot] = 0
          curLangs[slot] = ABSENT
        } else {
          curLines[slot] = change.lines
          curLangs[slot] = langIndex(change.lang, change.isBinary)
        }
      }
      let total = 0
      let files = 0
      const base = row * this.slots
      for (let i = 0; i < this.slots; i++) {
        this.lines[base + i] = curLines[i]
        this.langs[base + i] = curLangs[i]
        if (curLangs[i] !== ABSENT) {
          files += 1
          total += curLines[i]
        }
      }
      this.totals[row] = total
      this.fileCounts[row] = files
    }
  }

  get sampleCount(): number {
    return this.samples.length
  }

  /**
   * Writes instance-ready values for one sample row into `out`
   * (`slots * STRIDE` floats). Absent slots stay zero, which is how the morph
   * recognises an empty lot.
   */
  targetsInto(row: number, out: Float32Array): void {
    out.fill(0)
    const base = row * this.slots
    for (let i = 0; i < this.slots; i++) {
      const lang = this.langs[base + i]
      if (lang === ABSENT) continue
      const lines = this.lines[base + i]
      const o = i * STRIDE
      out[o] = heightFor(lines)
      out[o + 1] = footprintFor(lines)
      const c = lang * 3
      out[o + 2] = LANG_RGB[c]
      out[o + 3] = LANG_RGB[c + 1]
      out[o + 4] = LANG_RGB[c + 2]
    }
  }

  /** Language line shares at `row`, largest first, capped for display. */
  langSlice(row: number, maxRows: number): LangSlice[] {
    const base = row * this.slots
    const byLang = new Map<number, number>()
    let total = 0
    for (let i = 0; i < this.slots; i++) {
      const lang = this.langs[base + i]
      if (lang === ABSENT) continue
      const lines = this.lines[base + i]
      if (lines <= 0) continue
      byLang.set(lang, (byLang.get(lang) ?? 0) + lines)
      total += lines
    }
    return Array.from(byLang, ([lang, lines]) => ({
      lang: LANG_NAMES[lang],
      lines,
      share: total ? lines / total : 0
    }))
      .sort((a, b) => b.lines - a.lines)
      .slice(0, maxRows)
  }
}