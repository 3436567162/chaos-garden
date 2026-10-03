// Phase 2: gesture recognition, staked structures, two-hand field.
import { SECTORS, thumbAngleDeg, sectorOf, angleDelta, HoldTracker, HOLD_MS } from '../js/anchor.js';
import { KINDS, buildStructure, pointCount, bounds } from '../js/structures.js';
import {
  FIELDS, FieldState, warp, fieldById,
  MIN_SEPARATION, REPEL_MAX, ATTRACT_MAX,
} from '../js/field.js';

let fail = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ->  ' + detail : ''}`);
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const W = 1200;
const H = 800;

// --- sector table ---------------------------------------------------------
console.log('--- the eight sectors ---');
check('eight sectors', SECTORS.length === 8, `${SECTORS.length}`);
check('each spans exactly 45 degrees', SECTORS.every((s, i) => {
  const next = SECTORS[(i + 1) % 8];
  const width = i === 7 ? next.from + 360 - s.from : next.from - s.from;
  return near(width, 45);
}), SECTORS.map((s) => `${s.from}..${s.to}`).join(' '));
check('contiguous with no gap', SECTORS.every((s, i) => i === 7 || near(s.to, SECTORS[i + 1].from)));
check('every sector has a distinct id', new Set(SECTORS.map((s) => s.id)).size === 8);
check('every sector has a distinct label', new Set(SECTORS.map((s) => s.label)).size === 8);
check('exactly one builder per sector id', SECTORS.every((s) => KINDS.includes(s.id)),
  KINDS.join(','));

console.log('\n--- thumb direction -> sector ---');
const dirs = [
  ['up', 0, -1], ['upright', 0.7, -0.7], ['right', 1, 0], ['downright', 0.7, 0.7],
  ['down', 0, 1], ['downleft', -0.7, 0.7], ['left', -1, 0], ['upleft', -0.7, -0.7],
];
dirs.forEach(([name, dx, dy], i) => {
  const a = thumbAngleDeg({ x: 0, y: 0 }, { x: dx, y: dy });
  check(`${name} -> ${SECTORS[i].label}`, sectorOf(a).id === SECTORS[i].id,
    `${a.toFixed(1)}deg`);
});
check('thumb on the palm gives null', thumbAngleDeg({ x: 0, y: 0 }, { x: 0, y: 0 }) === null);
check('sectorOf(null) is null', sectorOf(null) === null);
check('boundary 22.4 vs 22.6 fall in different sectors',
  sectorOf(22.4).id !== sectorOf(22.6).id, `${sectorOf(22.4).id} vs ${sectorOf(22.6).id}`);
check('angle wraps past 180', near(angleDelta(350, 10), 20), `${angleDelta(350, 10)}`);
check('angle delta is symmetric', near(angleDelta(45, 200), angleDelta(200, 45)));
check('angle delta with null is infinite', angleDelta(null, 10) === Infinity);
// Pointing left yields -90deg, which normalises into the sector whose centre is
// 270deg. Assert the normalised centre, not the label's English gloss.
check('negative angles normalise into the wrapped sector',
  sectorOf(thumbAngleDeg({ x: 0, y: 0 }, { x: -1, y: 0 })).id === SECTORS[6].id,
  '-90deg -> ' + SECTORS[6].id);
check('every sector centre resolves to itself', SECTORS.every((s) => {
  const centre = ((s.from + s.to) / 2 + 360) % 360;
  return sectorOf(centre).id === s.id;
}), 'no sector is shadowed by its neighbour');

// --- hold tracker ----------------------------------------------------------
console.log('\n--- hold tracker: a gesture is "still in one sector", not "in a sector" ---');
{
  const t = new HoldTracker();
  let fires = 0;
  let firedAt = null;
  for (let ms = 0; ms <= 2000; ms += 50) {
    const r = t.update('a', 40, true, ms);
    if (r.ready) { fires++; firedAt = ms; }
  }
  check('commits exactly once', fires === 1, `${fires} commits`);
  check('commits at the hold duration', firedAt >= HOLD_MS, `${firedAt}ms >= ${HOLD_MS}ms`);
  check('progress reaches 1', t.update('a', 40, true, 2000).progress === 1);
}
// Progress must track elapsed time, not be re-measured from the last frame —
// these compare against elapsed/HOLD_MS rather than a magic number.
const expected = (ms) => ms / HOLD_MS;
check('drifting inside the slop window keeps the hold', (() => {
  const t = new HoldTracker();
  t.update('a', 40, true, 0);
  return near(t.update('a', 20, true, 300).progress, expected(300), 0.02);
})(), '40deg -> 20deg, progress still tracks elapsed time');
check('drifting just past the slop window resets the hold', (() => {
  const t = new HoldTracker();
  t.update('a', 40, true, 0);
  return t.update('a', 100, true, 300).progress === 0;
})(), '60deg drift exceeds HOLD_SLOP_DEG');
check('a big swing resets the hold', (() => {
  const t = new HoldTracker();
  t.update('a', 40, true, 0);
  return t.update('a', 200, true, 300).progress === 0;
})());
check('releasing the pose resets the hold', (() => {
  const t = new HoldTracker();
  t.update('a', 40, true, 0);
  t.update('a', 40, false, 300);
  return t.update('a', 40, true, 400).progress === 0;
})());
check('a null angle resets the hold', (() => {
  const t = new HoldTracker();
  t.update('a', 40, true, 0);
  return t.update('a', null, true, 300).progress === 0;
})());
check('two hands hold independently', (() => {
  const t = new HoldTracker();
  t.update('a', 0, true, 0);
  const r = t.update('b', 180, true, 0);
  return r.progress === 0 && t.update('a', 0, true, 400).progress > 0.5;
})());
check('reset(id) forgets one pen', (() => {
  const t = new HoldTracker();
  t.update('a', 0, true, 0);
  t.reset('a');
  return t.update('a', 0, true, 300).progress === 0;
})());
check('clear() forgets all pens', (() => {
  const t = new HoldTracker();
  t.update('a', 0, true, 0);
  t.update('b', 90, true, 0);
  t.clear();
  return t.state.size === 0;
})());
check('not pointing never commits', (() => {
  const t = new HoldTracker();
  let fires = 0;
  for (let ms = 0; ms <= 1500; ms += 50) if (t.update('a', 40, false, ms).ready) fires++;
  return fires === 0;
})());
check('progress is monotonic during a hold', (() => {
  const t = new HoldTracker();
  let last = -1;
  for (let ms = 0; ms <= HOLD_MS; ms += 50) {
    const p = t.update('a', 40, true, ms).progress;
    if (p < last) return false;
    last = p;
  }
  return true;
})());

// --- structures -----------------------------------------------------------
console.log('\n--- structures ---');
check('eight builders', KINDS.length === 8, KINDS.join(', '));
for (const k of KINDS) {
  const s = buildStructure(k, 4242);
  const b = bounds(s);
  const pts = s.lines.reduce((n, l) => n + l.pts.length, 0);
  const finite = s.lines.every((l) => Number.isFinite(l.w) && l.w > 0
    && l.pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  const noDupes = s.lines.every((l) => l.pts.every((p, i) => i === 0
    || p.x !== l.pts[i - 1].x || p.y !== l.pts[i - 1].y));
  check(`${k}: finite, no duplicate points, non-empty`,
    finite && noDupes && pts > 20 && !b.empty && b.w > 20 && b.h > 20,
    `${s.lines.length} lines, ${pts} pts, ${Math.round(b.w)}x${Math.round(b.h)}`);
}
check('unknown kind falls back rather than throwing', (() => {
  const s = buildStructure('nope', 1);
  return s.lines.length > 0;
})());

console.log('\n--- determinism ---');
for (const k of KINDS) {
  const a = JSON.stringify(buildStructure(k, 999));
  const b = JSON.stringify(buildStructure(k, 999));
  const c = JSON.stringify(buildStructure(k, 1000));
  check(`${k}: same seed identical, different seed differs`, a === b && a !== c);
}
check('radial is centred', (() => {
  const s = buildStructure('radial', 7);
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const l of s.lines) for (const p of l.pts) { sx += p.x; sy += p.y; n++; }
  return Math.hypot(sx / n, sy / n) < 6;
})());
check('ripples are centred', (() => {
  const s = buildStructure('ripples', 7);
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const l of s.lines) for (const p of l.pts) { sx += p.x; sy += p.y; n++; }
  return Math.hypot(sx / n, sy / n) < 4;
})());
check('pointCount agrees with the lines', (() => {
  const s = buildStructure('mesh', 3);
  return pointCount(s) === s.lines.reduce((n, l) => n + l.pts.length, 0);
})());
check('bounds of an empty structure is flagged', bounds({ lines: [] }).empty === true);
{
  const s = buildStructure('mesh', 11);
  const longest = Math.max(...s.lines.filter((l) => l.pts.length === 2)
    .map((l) => Math.hypot(l.pts[1].x - l.pts[0].x, l.pts[1].y - l.pts[0].y)));
  check('mesh drops long edges so cells stay open', longest <= 96.001,
    `${longest.toFixed(1)}px max edge`);
}

// --- two-hand field --------------------------------------------------------
console.log('\n--- field: identity cases ---');
check('off is identity', JSON.stringify(warp('off', { x: 100, y: 100 }, { x: 800, y: 400 }, W, H)) === '{"x":100,"y":100}');
check('no anchor is identity', JSON.stringify(warp('mirror', { x: 100, y: 100 }, null, W, H)) === '{"x":100,"y":100}');
check('pens too close are identity',
  JSON.stringify(warp('mirror', { x: 100, y: 100 }, { x: 100 + MIN_SEPARATION - 1, y: 100 }, W, H)) === '{"x":100,"y":100}');
check('unknown mode is identity', JSON.stringify(warp('bogus', { x: 5, y: 5 }, { x: 900, y: 400 }, W, H)) === '{"x":5,"y":5}');

console.log('\n--- field: mirror ---');
check('reflects through the canvas midline',
  warp('mirror', { x: 300, y: 300 }, { x: 900, y: 300 }, W, H).x === 900, '300 -> 900');
check('midline is a fixed point',
  warp('mirror', { x: 600, y: 300 }, { x: 900, y: 300 }, W, H).x === 600);
check('y is preserved', warp('mirror', { x: 300, y: 250 }, { x: 900, y: 300 }, W, H).y === 250);
check('the two pens land on different halves', (() => {
  const a = warp('mirror', { x: 300, y: 0 }, { x: 900, y: 0 }, W, H).x;
  const b = warp('mirror', { x: 900, y: 0 }, { x: 300, y: 0 }, W, H).x;
  return a !== b;
})(), 'halves do not overwrite each other');

console.log('\n--- field: attract ---');
// How far the pen itself moved toward the anchor. Measuring from the anchor
// would report the residual gap, not the pull.
const pullFrom = (x, anchorX) => {
  const moved = warp('attract', { x, y: 300 }, { x: anchorX, y: 300 }, W, H);
  return Math.abs(moved.x - x);
};
check('close pens pull toward each other', (() => {
  const r = warp('attract', { x: 600, y: 300 }, { x: 800, y: 300 }, W, H);
  return r.x > 600 && r.x < 800;
})(), `600 -> ${warp('attract', { x: 600, y: 300 }, { x: 800, y: 300 }, W, H).x}`);
check('pull grows with separation', pullFrom(600, 800) < pullFrom(200, 1000),
  `${pullFrom(600, 800).toFixed(0)}px close vs ${pullFrom(200, 1000).toFixed(0)}px far`);
check('pull is capped', pullFrom(200, 1000) <= ATTRACT_MAX + 0.001, `${pullFrom(200, 1000).toFixed(1)}px of ${ATTRACT_MAX}px`);
check('caps keep the pens from crossing', (() => {
  const a = warp('attract', { x: 500, y: 400 }, { x: 560, y: 400 }, W, H);
  const b = warp('attract', { x: 560, y: 400 }, { x: 500, y: 400 }, W, H);
  return a.x < b.x;
})(), 'a pen cannot overtake the other');
check('symmetric hands converge under the midpoint', (() => {
  const L = { x: 400, y: 400 };
  const R = { x: 800, y: 400 };
  const l2 = warp('attract', L, R, W, H);
  const r2 = warp('attract', R, L, W, H);
  return l2.x > L.x && r2.x < R.x && r2.x - l2.x < R.x - L.x;
})());
check('attract does not cross the anchor',
  warp('attract', { x: 100, y: 300 }, { x: 900, y: 300 }, W, H).x < 900);

console.log('\n--- field: repel ---');
check('pushes away from the other pen', (() => {
  const r = warp('repel', { x: 400, y: 300 }, { x: 900, y: 300 }, W, H);
  return r.x < 400;
})(), `400 -> ${warp('repel', { x: 400, y: 300 }, { x: 900, y: 300 }, W, H).x}`);
check('push is capped', (() => {
  const r = warp('repel', { x: 300, y: 300 }, { x: 1100, y: 300 }, W, H);
  return 300 - r.x <= REPEL_MAX + 0.001;
})(), `${(300 - warp('repel', { x: 300, y: 300 }, { x: 1100, y: 300 }, W, H).x).toFixed(0)}px`);
check('never pushes ink off-screen', (() => {
  const r = warp('repel', { x: 5, y: 300 }, { x: 1100, y: 300 }, W, H);
  return r.x >= 8 && r.x <= W - 8;
})(), `${warp('repel', { x: 5, y: 300 }, { x: 1100, y: 300 }, W, H).x}`);
check('vertical separation is handled too', (() => {
  const r = warp('repel', { x: 600, y: 100 }, { x: 600, y: 600 }, W, H);
  return r.y < 100;
})());

console.log('\n--- field: engagement ---');
const pen = (x, y, down) => ({ x, y, down });
check('four modes', FIELDS.length === 4, FIELDS.map((f) => f.label).join(' / '));
check('mode off never engages', (() => {
  const f = new FieldState();
  return f.update([pen(300, 400, true), pen(900, 400, true)], 1 / 60, W, H) === 'off';
})());
{
  const f = new FieldState();
  f.set('attract');
  check('both pens down and wide engages', f.update([pen(300, 400, true), pen(900, 400, true)], 1 / 60, W, H) === 'attract');
  check('one pen up disengages', f.update([pen(300, 400, true), pen(900, 400, false)], 1 / 60, W, H) === 'off');
  check('both pens up disengages', f.update([pen(300, 400, false), pen(900, 400, false)], 1 / 60, W, H) === 'off');
  check('one hand only disengages', f.update([pen(300, 400, true)], 1 / 60, W, H) === 'off');
  check('no hands disengages', f.update([], 1 / 60, W, H) === 'off');
  check('pens too close disengage', f.update([pen(400, 400, true), pen(400 + MIN_SEPARATION - 5, 400, true)], 1 / 60, W, H) === 'off');
}
check('fieldById falls back to off', fieldById('bogus').id === 'off');
check('cycle() wraps through all four', (() => {
  const f = new FieldState();
  const seen = [f.cycle(), f.cycle(), f.cycle(), f.cycle()];
  return new Set(seen).size === 4 && f.cycle() === 'mirror';
})());

console.log('\n--- field: easing ---');
check('amount eases in rather than snapping', (() => {
  const f = new FieldState();
  f.set('attract');
  const first = f.update([pen(300, 400, true), pen(900, 400, true)], 1 / 60, W, H);
  return first === 'attract' && f.amount > 0 && f.amount < 0.5;
})(), `first frame amount ${(() => { const f = new FieldState(); f.set('attract'); f.update([pen(300, 400, true), pen(900, 400, true)], 1 / 60, W, H); return f.amount.toFixed(3); })()}`);
check('amount plateaus at 1', (() => {
  const f = new FieldState();
  f.set('attract');
  for (let i = 0; i < 200; i++) f.update([pen(300, 400, true), pen(900, 400, true)], 1 / 60, W, H);
  return f.amount > 0.99;
})());
check('amount eases out fully', (() => {
  const f = new FieldState();
  f.set('attract');
  for (let i = 0; i < 200; i++) f.update([pen(300, 400, true), pen(900, 400, true)], 1 / 60, W, H);
  for (let i = 0; i < 120; i++) f.update([pen(300, 400, true), pen(900, 400, false)], 1 / 60, W, H);
  return f.amount < 0.01;
})());
check('apply() is identity while the field is cold', (() => {
  const f = new FieldState();
  f.set('attract');
  f.amount = 0;
  return JSON.stringify(f.apply({ x: 300, y: 300 }, { x: 900, y: 300 })) === '{"x":300,"y":300}';
})());
check('apply() only moves partway while warming up', (() => {
  const f = new FieldState();
  f.set('attract');
  const target = warp('attract', { x: 300, y: 300 }, { x: 900, y: 300 }, W, H);
  f.amount = 0.5;
  const half = f.apply({ x: 300, y: 300 }, { x: 900, y: 300 });
  return half.x > 300 && half.x < target.x;
})());

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail ? 1 : 0);