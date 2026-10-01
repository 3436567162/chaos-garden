// Deterministic path → grid position.
//
// The layout is computed once over the union of every path that ever exists
// in the timeline, so a file keeps its plot of land for its whole life: files
// that do not exist yet leave an empty lot, deleted files leave a hole.
//
// Rules:
//   * directory depth picks the band (Z axis); root files sit closest to the camera
//   * inside a band paths are sorted by code unit order (stable across locales),
//     so siblings in the same directory are neighbours
//   * a band wraps into rows of a fixed column count, keeping the city roughly square

export const CELL = 1.4
const BAND_GAP_ROWS = 1.5

export interface Layout {
  /** path → slot index; slots index into x/z and the instanced mesh. */
  slotOf: Map<string, number>
  paths: string[]
  x: Float32Array
  z: Float32Array
  cols: number
  /** Half extents of the occupied area, world units. */
  halfWidth: number
  halfDepth: number
  /** First row (in row units) of each depth band, for future labelling. */
  bands: { depth: number; firstRow: number; rows: number }[]
}

function depthOf(path: string): number {
  let d = 0
  for (let i = 0; i < path.length; i++) if (path.charCodeAt(i) === 47) d++
  return d
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function computeLayout(allPaths: Iterable<string>): Layout {
  const unique = Array.from(new Set(allPaths))
  const byDepth = new Map<number, string[]>()
  for (const p of unique) {
    const d = depthOf(p)
    let list = byDepth.get(d)
    if (!list) byDepth.set(d, (list = []))
    list.push(p)
  }
  const depths = Array.from(byDepth.keys()).sort((a, b) => a - b)
  for (const d of depths) byDepth.get(d)!.sort(byCodeUnit)

  const cols = Math.max(8, Math.ceil(Math.sqrt(unique.length) * 1.25))

  const paths: string[] = []
  const gridCol: number[] = []
  const gridRow: number[] = []
  const bands: Layout['bands'] = []
  let row = 0
  for (const d of depths) {
    const list = byDepth.get(d)!
    const rows = Math.ceil(list.length / cols)
    bands.push({ depth: d, firstRow: row, rows })
    list.forEach((p, i) => {
      paths.push(p)
      gridCol.push(i % cols)
      gridRow.push(row + Math.floor(i / cols))
    })
    row += rows + BAND_GAP_ROWS
  }
  const totalRows = Math.max(1, row - BAND_GAP_ROWS)

  const n = paths.length
  const x = new Float32Array(n)
  const z = new Float32Array(n)
  const slotOf = new Map<string, number>()
  const offX = ((cols - 1) * CELL) / 2
  const offZ = ((totalRows - 1) * CELL) / 2
  for (let i = 0; i < n; i++) {
    x[i] = gridCol[i] * CELL - offX
    // Deeper bands recede away from the default camera (which looks towards -Z).
    z[i] = offZ - gridRow[i] * CELL
    slotOf.set(paths[i], i)
  }

  return {
    slotOf,
    paths,
    x,
    z,
    cols,
    halfWidth: (cols * CELL) / 2,
    halfDepth: (totalRows * CELL) / 2,
    bands
  }
}
