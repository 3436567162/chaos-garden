// Synthetic timeline generator for measuring the renderer at scale.
//
// Deterministic given (slots, samples), so a benchmark run is reproducible.
// Emitted in the same delta format the Rust scanner produces, so it exercises
// the real History replay and the real render path rather than a shortcut.
//
// Enabled with VITE_CHRONOSCOPE_STRESS=<slots>, e.g. 50000. See the README.

import type { FileChange, Sample, ScanResult } from './types'

/** mulberry32: small, fast, good enough, and reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DIRS = [
  'src', 'src/core', 'src/ui', 'src/hooks', 'src/lib',
  'crates/engine/src', 'crates/engine/src/render', 'crates/protocol/src',
  'packages/app/src', 'packages/ui/src', 'packages/api/src',
  'tests/unit', 'tests/fixtures', 'docs/guides', 'docs/reference',
  'tools/scripts', 'examples/basic/src', 'third_party/legacy/include'
]

const EXTS: [string, string][] = [
  ['ts', 'TypeScript'], ['tsx', 'TypeScript'], ['rs', 'Rust'],
  ['go', 'Go'], ['py', 'Python'], ['css', 'CSS'], ['md', 'Markdown'],
  ['json', 'JSON'], ['yml', 'YAML'], ['toml', 'TOML'], ['sh', 'Shell']
]

/**
 * Log-ish line counts, so a handful of files dominate the skyline the way they
 * do in a real repository. A linear distribution would make every tower the
 * same height and hide the interesting case.
 */
function linesFor(r: number): number {
  const bucket = r * r * r
  if (bucket < 0.02) return 0 // binary-ish
  return Math.max(1, Math.round(Math.exp(3 + bucket * 9)))
}

function oid(seed: number, i: number): string {
  const a = (seed * 2654435761 + i * 40503) >>> 0
  return a.toString(16).padStart(8, '0').repeat(5).slice(0, 40)
}

export function makeStressScan(slots: number, samples: number): ScanResult {
  const count = Math.max(1, Math.floor(slots))
  const stops = Math.max(1, Math.floor(samples))
  const random = rng(0x5eed)

  // Sort the pairs, not the two arrays separately: sorting paths alone would
  // silently desync the language mapping.
  const files: { path: string; lang: string }[] = []
  for (let i = 0; i < count; i++) {
    const dir = DIRS[i % DIRS.length]
    const [ext, lang] = EXTS[Math.floor(random() * EXTS.length)]
    files.push({ path: `${dir}/mod_${i.toString(36)}.${ext}`, lang })
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1))
  const paths = files.map(f => f.path)
  const langOf = files.map(f => f.lang)

  const baseTime = Date.UTC(2021, 0, 4, 9, 0) / 1000
  const out: Sample[] = []
  // Live state as a sparse map path -> line count.
  const live = new Map<string, number>()
  let parent: string | null = null

  for (let s = 0; s < stops; s++) {
    const changes: FileChange[] = []
    const isFirst = s === 0
    const isLast = s === stops - 1

    if (isFirst) {
      // Seed the city: everything exists at commit 0.
      for (let i = 0; i < count; i++) {
        const lines = linesFor(random())
        live.set(paths[i], lines)
        changes.push({ path: paths[i], lang: langOf[i], lines, isBinary: false })
      }
    } else {
      // Touch a slice of the tree per commit, the way a busy repo does.
      const churn = Math.max(1, Math.round(count * 0.012))
      for (let k = 0; k < churn; k++) {
        const i = Math.floor(random() * count)
        const path = paths[i]
        if (random() < 0.04) {
          // Delete, but never the last commit: the city should not empty out.
          if (!isLast && live.delete(path)) {
            changes.push({ path, lang: '', lines: null, isBinary: false })
          }
          continue
        }
        const lines = linesFor(random())
        const before = live.get(path)
        if (before === lines) continue
        live.set(path, lines)
        if (before !== undefined || random() < 0.5) {
          changes.push({ path, lang: langOf[i], lines, isBinary: false })
        }
      }
    }

    const id = oid(0xc0ffee, s)
    out.push({
      oid: id,
      parents: parent ? [parent] : [],
      timestamp: baseTime + s * 36 * 3600,
      message: `synthetic(${s}) ${isFirst ? 'import tree' : 'churn ' + changes.length + ' files'}`,
      authorName: ['Ada', 'Lin', 'Sam', 'Noor'][s % 4],
      authorEmail: `dev${s % 4}@example.com`,
      changes
    })
    parent = id
  }

  return {
    repoName: `synthetic (${count.toLocaleString()} files, ${stops} stops)`,
    head: out[out.length - 1].oid,
    commitCount: stops,
    firstTimestamp: out[0].timestamp,
    lastTimestamp: out[out.length - 1].timestamp,
    fileCount: count,
    strided: false,
    samples: out,
    fromCache: false
  }
}

/** Slot count requested by the dev environment, or 0 when stress mode is off. */
export function stressSlotsFromEnv(): number {
  const raw = (import.meta as { env?: Record<string, string> }).env
    ?.VITE_CHRONOSCOPE_STRESS
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}