import { makeRng, lerp } from './util.js';

const TAU = Math.PI * 2;

// A structure is a list of polylines in local coordinates, origin at the
// stake. Each polyline carries a starting width; the renderer tapers along it.
// Everything is seeded, so the same gesture always regrows the same shape —
// Math.random() would make every replay of the same pose a different drawing.
// Generators emit geometry only; placement, growth and drawing are InkField's job.

function poly(w) {
  return { pts: [], w };
}

function to(lines, line, x, y) {
  const p = line.pts[line.pts.length - 1];
  if (p && Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9) return;
  line.pts.push({ x, y });
}

function stroke(lines, w = 1) {
  const l = poly(w);
  lines.push(l);
  return l;
}

function node(lines, x, y, w = 1) {
  const l = stroke(lines, w);
  to(lines, l, x, y);
  return l;
}

/** 晶格 — a staggered lattice that thins toward the rim. */
function lattice(rng) {
  const lines = [];
  const rings = 4;
  const perRing = [6, 10, 14, 18];
  const nodes = [];
  for (let r = 0; r < rings; r++) {
    const rad = 34 + r * 30;
    const count = perRing[r];
    const stagger = r % 2 ? Math.PI / count : 0;
    const row = [];
    for (let i = 0; i < count; i++) {
      const a = stagger + (i / count) * TAU + rng.jitter(0.06);
      const rr = rad * (1 + rng.jitter(0.09));
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      node(lines, x, y, lerp(2.6, 0.9, r / rings));
      row.push({ x, y });
    }
    nodes.push(row);
  }
  for (let r = 0; r < rings; r++) {
    const w = lerp(0.7, 0.4, r / rings);
    for (let i = 0; i < nodes[r].length; i++) {
      const a = nodes[r][i];
      const b = nodes[r][(i + 1) % nodes[r].length];
      const l = stroke(lines, w);
      to(lines, l, a.x, a.y);
      to(lines, l, b.x, b.y);
      if (r + 1 < rings) {
        const n = nodes[r + 1][Math.floor((i / nodes[r].length) * nodes[r + 1].length)];
        if (n) to(lines, l, n.x, n.y);
      }
    }
  }
  return lines;
}

/** 分形 — recursive branching, three levels, angle narrowing per level. */
function fractal(rng) {
  const lines = [];
  const walk = (x, y, a, len, depth, w) => {
    const steps = Math.max(2, Math.round(len / 16));
    let px = x;
    let py = y;
    const l = stroke(lines, w);
    to(lines, l, px, py);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      px += Math.cos(a) * (len / steps);
      py += Math.sin(a) * (len / steps);
      to(lines, l, px, py);
      l.w = Math.max(l.w, w * lerp(1, 0.6, t));
    }
    if (depth <= 0) return;
    const spread = lerp(0.62, 0.34, 1 - depth / 3);
    const n = depth === 3 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * spread + rng.jitter(0.16);
      walk(px, py, a + off, len * lerp(0.68, 0.5, rng.next()), depth - 1, w * 0.62);
    }
  };
  walk(0, 30, -Math.PI / 2, 62, 3, 2.4);
  return lines;
}

/** 放射 — rays whose reach is driven by a low-frequency wave. */
function radial(rng) {
  const lines = [];
  const count = 14;
  const phase = rng.range(0, TAU);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    const wave = 0.55 + 0.45 * Math.sin(i * 1.7 + phase);
    const len = lerp(38, 132, wave) * (1 + rng.jitter(0.12));
    const bend = rng.jitter(0.28);
    const steps = 7;
    let px = 0;
    let py = 0;
    const l = stroke(lines, 2.4);
    to(lines, l, px, py);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const th = a + bend * t * t;
      px = Math.cos(th) * len * t;
      py = Math.sin(th) * len * t;
      to(lines, l, px, py);
    }
    l.w = 2.4;
    node(lines, px, py, 1.6);
  }
  node(lines, 0, 0, 3.4);
  return lines;
}

/** 双螺旋 — two counter-rotating arms with rungs between them. */
function helix(rng) {
  const lines = [];
  const arms = 2;
  const turns = 2.15;
  const phase = rng.range(0, TAU);
  const paths = [];
  for (let arm = 0; arm < arms; arm++) {
    const path = [];
    const steps = 130;
    const l = stroke(lines, 2.6);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const th = phase + arm * Math.PI + t * TAU * turns;
      const r = lerp(16, 118, t);
      const x = Math.cos(th) * r;
      const y = Math.sin(th) * r;
      path.push({ x, y });
      to(lines, l, x, y);
    }
    paths.push(path);
  }
  for (let i = 4; i < paths[0].length - 4; i += 9) {
    if (rng.next() > 0.72) continue;
    const a = paths[0][i];
    const b = paths[1][i];
    const l = stroke(lines, 0.6);
    to(lines, l, a.x, a.y);
    to(lines, l, b.x, b.y);
  }
  return lines;
}

/** 环 — concentric polygon rings with deliberate gaps. */
function rings(rng) {
  const lines = [];
  const count = 5;
  const sides = rng.pick([3, 5, 6, 8]);
  for (let r = 0; r < count; r++) {
    const rad = 26 + r * 27;
    const gapAt = Math.floor(rng.range(0, sides));
    const gapWidth = rng.range(0.4, 0.9);
    const spin = rng.range(0, TAU);
    const w = lerp(2.2, 0.7, r / count);
    for (let i = 0; i < sides; i++) {
      const mid = ((i + 0.5) / sides) * TAU;
      const d = Math.abs(((mid - (gapAt + 0.5) * (TAU / sides) + Math.PI * 3) % TAU) - Math.PI);
      if (Math.PI - d < gapWidth) continue;
      const a0 = spin + (i / sides) * TAU;
      const a1 = spin + ((i + 1) / sides) * TAU;
      const l = stroke(lines, w);
      to(lines, l, Math.cos(a0) * rad, Math.sin(a0) * rad);
      to(lines, l, Math.cos(a1) * rad, Math.sin(a1) * rad);
    }
  }
  node(lines, 0, 0, 2.6);
  return lines;
}

/** 星芒 — a spike with barbs, repeated with variation. */
function starburst(rng) {
  const lines = [];
  const count = 5;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + rng.jitter(0.18);
    const len = 70 + rng.range(0, 66);
    const steps = 5;
    let px = 0;
    let py = 0;
    const l = stroke(lines, 3);
    to(lines, l, px, py);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      px = Math.cos(a) * len * t;
      py = Math.sin(a) * len * t;
      to(lines, l, px, py);
    }
    l.w = 3;
    const barbs = 3;
    for (let b = 1; b <= barbs; b++) {
      const t = b / (barbs + 1);
      const r = len * t;
      const side = b % 2 ? 1 : -1;
      const a2 = a + side * lerp(0.6, 0.34, t);
      const bl = len * 0.24;
      const bl2 = stroke(lines, 1.1);
      to(lines, bl2, Math.cos(a) * r, Math.sin(a) * r);
      to(lines, bl2, Math.cos(a) * r + Math.cos(a2) * bl, Math.sin(a) * r + Math.sin(a2) * bl);
    }
    node(lines, px, py, 1.4);
  }
  return lines;
}

/** 网格 — irregular triangulation; long edges are dropped so cells stay open. */
function mesh(rng) {
  const lines = [];
  const n = 16;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.jitter(0.22);
    const r = 30 + Math.sqrt(rng.next()) * 108;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (Math.hypot(b.x - a.x, b.y - a.y) > 96) continue;
    const l = stroke(lines, 0.9);
    to(lines, l, a.x, a.y);
    to(lines, l, b.x, b.y);
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const c = pts[(i + 2) % n];
    if (Math.hypot(c.x - a.x, c.y - a.y) >= 74) continue;
    const l = stroke(lines, 0.55);
    to(lines, l, a.x, a.y);
    to(lines, l, c.x, c.y);
  }
  for (const p of pts) node(lines, p.x, p.y, 1.5);
  return lines;
}

/** 波纹 — concentric ripples, phase-shifted so they never look stamped. */
function ripples(rng) {
  const lines = [];
  const count = 7;
  const phase = rng.range(0, TAU);
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / count;
    const rad = lerp(22, 138, Math.sqrt(t));
    const steps = 64;
    const lobes = 3 + rng.int(4);
    const wob = rng.range(4, 13);
    let prev = null;
    for (let s = 0; s <= steps; s++) {
      const a = (s / steps) * TAU;
      const r = rad + Math.sin(a * lobes + phase + i) * wob;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (prev) {
        const l = stroke(lines, lerp(0.6, 1.9, 1 - t));
        to(lines, l, prev.x, prev.y);
        to(lines, l, x, y);
      }
      prev = { x, y };
    }
  }
  node(lines, 0, 0, 2.2);
  return lines;
}

const BUILDERS = { lattice, fractal, radial, helix, rings, starburst, mesh, ripples };

export function buildStructure(kind, seed) {
  const fn = BUILDERS[kind] || lattice;
  return { kind, seed, lines: fn(makeRng(seed)) };
}

/** Total point count, used to normalise growth speed across shapes. */
export function pointCount(structure) {
  let n = 0;
  for (const l of structure.lines) n += l.pts.length;
  return n;
}

/** Local-space bounding box, used to keep a structure clear of the canvas edge. */
export function bounds(structure) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const l of structure.lines) {
    for (const p of l.pts) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, empty: !Number.isFinite(x0) };
}

export const KINDS = Object.keys(BUILDERS);