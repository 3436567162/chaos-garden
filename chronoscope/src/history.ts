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
import { BINARY_INDEX, LANG_NAMES, LANG_RGB, langIndex, langName } from './three/palette'

/** Slot absent marker; every real language index is >= 0. */
const ABSENT = -1

export interface LangSlice {
  lang: string
  lines: number
  share: number
}

/** One point in a single file's life. */
export interface FileRevision {
  /** Sample row where this state began. */
  row: number
  deleted: boolean
  lines: number
  lang: string
  isBinary: boolean
  /** Line change against the previous revision; null on first appearance. */
  delta: number | null
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

  /** Path owning a slot. */
  pathAt(slot: number): string {
    return this.layout.paths[slot] ?? ''
  }

  slotOf(path: string): number | undefined {
    return this.layout.slotOf.get(path)
  }

  /** True when the file exists at this sample. */
  existsAt(row: number, slot: number): boolean {
    if (row < 0 || row >= this.sampleCount) return false
    return this.langs[row * this.slots + slot] !== ABSENT
  }

  /** Line count at a sample; 0 when absent. */
  linesAt(row: number, slot: number): number {
    if (row < 0 || row >= this.sampleCount) return 0
    return this.lines[row * this.slots + slot]
  }

  /** Language name at a sample; empty when absent. */
  langAt(row: number, slot: number): string {
    if (row < 0 || row >= this.sampleCount) return ''
    const l = this.langs[row * this.slots + slot]
    return l === ABSENT ? '' : langName(l)
  }

  /**
   * Every sample where one file's content changed, oldest first. Walks the whole
   * grid for that slot, which is O(stops) — cheap enough to compute on click.
   */
  fileHistory(slot: number): FileRevision[] {
    const out: FileRevision[] = []
    let present = false
    let prevLines = 0
    let prevLang = ABSENT

    for (let row = 0; row < this.sampleCount; row++) {
      const base = row * this.slots + slot
      const lang = this.langs[base]
      if (lang === ABSENT) {
        if (present) {
          out.push({
            row,
            deleted: true,
            lines: 0,
            lang: '',
            isBinary: false,
            delta: null
          })
        }
        present = false;
        prevLang = ABSENT;
        continue;
      }
      const lines = this.lines[base]
      if (!present || lines !== prevLines || lang !== prevLang) {
        out.push({
          row,
          deleted: false,
          lines,
          lang: langName(lang),
          isBinary: lang === BINARY_INDEX,
          delta: present ? lines - prevLines : null
        });
        present = true;
        prevLines = lines;
        prevLang = lang;
      }
    }
    return out
  }

  /**
   * Slots whose content differs between two samples — the suspects when a
   * bisect lands on a culprit. One pass over the two rows.
   */
  changedBetween(lo: number, hi: number): number[] {
    if (lo === hi) return []
    const a = Math.min(lo, hi) * this.slots
    const b = Math.max(lo, hi) * this.slots
    const out: number[] = []
    for (let i = 0; i < this.slots; i++) {
      const lineA = this.lines[a + i]
      const langA = this.langs[a + i]
      const lineB = this.lines[b + i]
      const langB = this.langs[b + i]
      if (lineA !== lineB || langA !== langB) out.push(i)
    }
    return out
  }

  /** Samples whose commit message contains `needle`, case-insensitively. */
  search(needle: string): number[] {
    const q = needle.trim().toLowerCase();
    if (!q) return []
    const out: number[] = []
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i];
      if (
        s.message.toLowerCase().includes(q) ||
        s.authorName.toLowerCase().includes(q)
      ) {
        out.push(i)
      }
    }
    return out
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