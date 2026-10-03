const TAU = Math.PI * 2;
const CELL = 20;

/** Stable pseudo-random in 0..1. For anything that must look random but stay
 *  put between frames — per-frame Math.random() strobes. */
export function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Coarse wetness grid.
 *
 * A droplet has to be able to tell wet ink from dry paper, and reading pixels
 * back off the ink canvas is far too slow to do per droplet per frame. So
 * wetness is tracked as a ~20px occupancy field that dries out over a couple
 * of seconds, which is also what makes ink wick outward from a wet area.
 */
export class Wetness {
  constructor(w, h, cell = CELL) {
    this.cell = cell;
    this.cols = Math.ceil(w / cell);
    this.rows = Math.ceil(h / cell);
    this.data = new Float32Array(this.cols * this.rows);
    // Cells that currently hold ink. Drying sweeps this list instead of the
    // whole grid: on a 1920x1080 canvas the grid is 5184 cells but a typical
    // frame wets a few dozen, and the dry ones would cost the same to visit.
    this.dirty = new Set();
  }

  at(x, y) {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return 0;
    return this.data[cy * this.cols + cx];
  }

  mark(x, y, r, amount) {
    const c0 = Math.max(0, Math.floor((x - r) / this.cell));
    const c1 = Math.min(this.cols - 1, Math.floor((x + r) / this.cell));
    const r0 = Math.max(0, Math.floor((y - r) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.floor((y + r) / this.cell));
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const i = cy * this.cols + cx;
        if (this.data[i] < amount) {
          this.data[i] = amount;
          this.dirty.add(i);
        }
      }
    }
  }

  dry(dt, rate = 0.6) {
    const k = Math.exp(-rate * dt);
    const d = this.data;
    // Mutating while iterating a Set is safe in JS: entries deleted during
    // iteration are simply not visited, and entries added are not visited.
    for (const i of this.dirty) {
      const v = d[i] * k;
      if (v < 1e-3) {
        d[i] = 0;
        this.dirty.delete(i);
      } else {
        d[i] = v;
      }
    }
  }

  get wetCells() {
    return this.dirty.size;
  }

  clear() {
    this.data.fill(0);
    this.dirty.clear();
  }
}

/**
 * Allocate the splay hairs for one pen.
 *
 * Each hair owns a fixed slot across the width band and a fixed dropout bias,
 * so raising the speed sheds hairs in a stable order. Re-allocating per frame
 * would make the gaps crawl instead of travelling with the stroke.
 */
export function splayHairs(count) {
  const hairs = [];
  for (let i = 0; i < count; i++) {
    hairs.push({
      slot: ((i + 0.5) / count) * 2 - 1,           // -1 .. 1 across the band
      bias: i / count + hash01(i * 4.7) * 0.08,   // dropout order
      w: 0.72 + hash01(i * 9.3) * 0.7,            // relative thickness
      wob: hash01(i * 15.1) * TAU,                // phase of the idle drift
    });
  }
  return hairs;
}

/**
 * Which hairs still touch the paper at a given dryness.
 * The gaps between the survivors are the 飞白.
 */
export function survivingHairs(hairs, dryness, chunk) {
  const keep = 1 - Math.max(0, Math.min(1, dryness));
  return hairs.filter((h) => hash01(h.bias * 91.7 + chunk * 13.31 + h.slot * 57.13) <= keep);
}

/** Screen-space chunk index; keeps the flying white ragged, not striped. */
export const pathChunk = (x, y) => Math.floor((x * 0.7 + y * 1.3) / 9);