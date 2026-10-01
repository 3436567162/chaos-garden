// Phase 0 fixture: a hand-written 8-commit history for a fictional project.
// Replaced by the real scanner in Phase 1.

import type { FileEntry, Snapshot, Timeline } from './types'

const EXT_LANG: Record<string, string> = {
  rs: 'Rust', ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', css: 'CSS',
  md: 'Markdown', toml: 'TOML', json: 'JSON', yml: 'YAML', html: 'HTML', svg: 'XML', png: 'Binary'
}

function langOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return EXT_LANG[ext] ?? 'Unknown'
}

function fakeOid(seed: string): string {
  // FNV-1a, expanded to 40 hex chars. Deterministic, not a real hash.
  let out = ''
  let h = 0x811c9dc5
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193)
    h = Math.imul(h ^ round, 0x01000193)
    out += (h >>> 0).toString(16).padStart(8, '0')
  }
  return out
}

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 0x100000000
}

type Op = [path: string, lines: number] | [path: string, 'rm']

interface CommitSpec {
  daysAfter: number
  author: 0 | 1 | 2
  message: string
  ops: Op[]
}

const AUTHORS = [
  { name: 'Ada Example', email: 'ada@example.com' },
  { name: 'Lin Example', email: 'lin@example.com' },
  { name: 'Sam Example', email: 'sam@example.com' }
]

function family(dir: string, names: string[], ext: string, seed: number, base: number, spread: number): Op[] {
  const r = rng(seed)
  return names.map(n => [`${dir}/${n}.${ext}`, Math.round(base + r() * spread)] as Op)
}

const COMPONENTS = ['Button', 'Panel', 'Toolbar', 'Tooltip', 'Slider', 'Tabs', 'Modal', 'Badge', 'Splitter', 'Tree']
const VIEWS = ['Overview', 'Files', 'History', 'Settings', 'About']
const ICONS = Array.from({ length: 24 }, (_, i) => `icon-${String(i + 1).padStart(2, '0')}`)
const ROUTES = ['health', 'scan', 'snapshot', 'files', 'search', 'export']

const COMMITS: CommitSpec[] = [
  { daysAfter: 0, author: 0, message: 'Initial commit', ops: [
    ['README.md', 24], ['Cargo.toml', 14], ['.gitignore', 6], ['src/main.rs', 42]
  ] },
  { daysAfter: 9, author: 0, message: 'Add scanner core and CLI', ops: [
    ['src/main.rs', 88], ['src/scan.rs', 310], ['src/model.rs', 96], ['src/cli/mod.rs', 40],
    ['src/cli/args.rs', 132], ['src/cli/output.rs', 210], ['Cargo.toml', 22]
  ] },
  { daysAfter: 23, author: 1, message: 'Bootstrap web dashboard', ops: [
    ['web/package.json', 34], ['web/tsconfig.json', 22], ['web/index.html', 14],
    ['web/src/main.tsx', 18], ['web/src/App.tsx', 120], ['web/src/styles.css', 260],
    ...family('web/src/components', COMPONENTS.slice(0, 5), 'tsx', 11, 40, 160)
  ] },
  { daysAfter: 41, author: 0, message: 'Config loader and on-disk cache', ops: [
    ['src/config.rs', 180], ['src/cache/mod.rs', 60], ['src/cache/sqlite.rs', 420],
    ['src/cache/migrate.rs', 140], ['src/scan.rs', 520], ['src/cli/output.rs', 260]
  ] },
  { daysAfter: 64, author: 1, message: 'Dashboard views, charts and icon set', ops: [
    ...family('web/src/components', COMPONENTS, 'tsx', 12, 50, 220),
    ...family('web/src/views', VIEWS, 'tsx', 13, 120, 380),
    ...family('web/src/components/charts', ['AreaChart', 'Bars', 'Sparkline'], 'tsx', 14, 140, 260),
    ...family('web/public/icons', ICONS, 'svg', 15, 6, 30),
    ['web/public/logo.png', 0], ['web/src/i18n/en.json', 210], ['web/src/i18n/zh.json', 210],
    ['web/src/App.tsx', 190]
  ] },
  { daysAfter: 92, author: 2, message: 'Remove legacy CLI, serve over HTTP', ops: [
    ['src/cli/mod.rs', 'rm'], ['src/cli/args.rs', 'rm'], ['src/cli/output.rs', 'rm'],
    ['src/server/mod.rs', 140], ['src/server/auth.rs', 260],
    ...family('src/server/routes', ROUTES, 'rs', 16, 80, 240),
    ['tests/server.rs', 380], ['tests/scan.rs', 290], ['.github/workflows/ci.yml', 64],
    ['src/main.rs', 54]
  ] },
  { daysAfter: 118, author: 0, message: 'Split scanner into worker modules; vendor chart lib', ops: [
    ['src/scan.rs', 'rm'], ['src/scan/mod.rs', 120], ['src/scan/walk.rs', 340], ['src/scan/blob.rs', 280],
    ['src/scan/sample.rs', 190], ['src/scan/lang.rs', 230],
    ['web/vendor/chartlib.min.js', 14800], ['web/src/views/History.tsx', 640]
  ] },
  { daysAfter: 151, author: 2, message: 'Release 1.0', ops: [
    ['CHANGELOG.md', 120], ['README.md', 210], ['docs/architecture.md', 340], ['docs/api.md', 520],
    ['web/vendor/chartlib.min.js', 'rm'], ['Cargo.toml', 31], ['web/package.json', 38],
    ...family('web/src/components', COMPONENTS, 'tsx', 17, 60, 260)
  ] }
]

export function buildMockTimeline(): Timeline {
  const t0 = Date.UTC(2024, 2, 4, 9, 30) / 1000
  const tree = new Map<string, FileEntry>()
  const snapshots: Snapshot[] = []
  let parent: string | null = null

  for (const spec of COMMITS) {
    for (const [path, v] of spec.ops) {
      if (v === 'rm') {
        tree.delete(path)
        continue
      }
      const isBinary = langOf(path) === 'Binary'
      tree.set(path, { path, blobOid: fakeOid(`${path}:${v}`), lang: langOf(path), lines: isBinary ? 0 : v, isBinary })
    }
    const author = AUTHORS[spec.author]
    const oid = fakeOid(`${parent ?? 'root'}:${spec.message}`)
    snapshots.push({
      commitOid: oid,
      parents: parent ? [parent] : [],
      timestamp: t0 + spec.daysAfter * 86400 + snapshots.length * 3917,
      message: spec.message,
      authorName: author.name,
      authorEmail: author.email,
      files: Array.from(tree.values()).sort((a, b) => (a.path < b.path ? -1 : 1))
    })
    parent = oid
  }

  return { repoName: 'lighthouse (demo data)', snapshots }
}
