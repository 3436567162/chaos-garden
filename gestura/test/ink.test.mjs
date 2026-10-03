// Throwaway harness: stub enough DOM to exercise the ink pipeline headlessly.
const noop = () => {};
const grad = { addColorStop: noop };
let strokes = 0;
let gradientCalls = 0;

function makeCtx(canvas) {
  return {
    canvas,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    setTransform: noop, save: noop, restore: noop,
    fillRect: noop, clearRect: noop, drawImage: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop,
    arc() { strokes++; }, fill: noop, stroke: noop,
    translate: noop, rotate: noop, scale: noop,
    createRadialGradient() { gradientCalls++; return grad; },
  };
}
const makeCanvas = () => {
  const c = { width: 0, height: 0, style: {} };
  c.getContext = () => makeCtx(c);
  return c;
};

globalThis.document = { createElement: () => makeCanvas() };
globalThis.window = { devicePixelRatio: 1 };

const { InkField, NIBS, NIB_ORDER, PEN_UP, inkOf, drynessAt, widthAt, depositAt, ribbon } = await import('../js/stroke.js');
const { Wetness, splayHairs, survivingHairs, hash01, pathChunk } = await import('../js/paper.js');
const { fmt } = await import('../js/util.js');
const { GROW_MS, STAKE_LIMIT } = await import('../js/stroke.js');
const { SECTORS } = await import('../js/anchor.js');
const { KINDS } = await import('../js/structures.js');
const { FieldState } = await import('../js/field.js');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ->  ' + detail : ''}`);
};

const W = 1200;
const H = 800;
const field = new InkField(makeCanvas());
field.resize(W, H, 1);
// `indexRatio` is the pen-down signal (tip-to-wrist over PIP-to-wrist, straight
// finger ~1.9, folded ~1.0). `openness` only modulates width now.
const hand = (id, x, y, openness, indexRatio = 1.9) =>
  ({ id, screen: { x, y }, openness, indexRatio, seen: true });

// === 1. pure nib maths =====================================================
{
  const silk = NIBS.silk;
  check('width falls with speed', widthAt(silk, 0, 1) > widthAt(silk, silk.vRef, 1),
    `${widthAt(silk, 0, 1).toFixed(1)} -> ${widthAt(silk, silk.vRef, 1).toFixed(1)}`);
  check('width rises with pressure', widthAt(silk, 0, 1) > widthAt(silk, 0, 0));
  check('width never negative', widthAt(silk, 1e6, 0) > 0);
  check('slow silk is wet brush', depositAt(silk, 0, 1, 0) > 0.8, `${depositAt(silk, 0, 1, 0).toFixed(2)}`);
  check('fast silk deposits less', depositAt(silk, silk.vRef, 1, 0) < depositAt(silk, 0, 1, 0),
    `${depositAt(silk, silk.vRef, 1, 0).toFixed(2)}`);
  check('dry brush deposits less than wet', depositAt(NIBS.flying, 100, 1, 0.9) < depositAt(NIBS.flying, 100, 1, 0));
  check('deposit is clamped 0..1', [0, 1e6, -5].every((s) => {
    const v = depositAt(NIBS.splash, s, 1, 0.5);
    return v >= 0 && v <= 1;
  }));
  check('silk never dries', drynessAt(silk, 1e6) === 0);
  check('dryness rises with speed', drynessAt(NIBS.flying, 100) < drynessAt(NIBS.flying, NIBS.flying.vRef));
  check('dryness capped at nib.dry', Math.abs(drynessAt(NIBS.flying, 1e9) - NIBS.flying.dry) < 1e-9);
  const c = inkOf([200, 100, 50], 1);
  const d = inkOf([200, 100, 50], 0);
  check('pressure darkens ink', c[0] > d[0], `${d[0]} -> ${c[0]}`);
  check('fade lightens ink', inkOf([200, 100, 50], 1, 0.5)[0] < c[0]);
  check('ink channels stay in range', inkOf([255, 0, 128], 1).every((v) => v >= 0 && v <= 255));
}

// === 2. nib table invariants ==============================================
for (const name of NIB_ORDER) {
  const n = NIBS[name];
  const ok = n.maxW > n.minW && n.minW >= 0 && n.vRef > 0 && n.dry >= 0 && n.dry <= 1
    && n.splatter >= 0 && n.splatter <= 1 && n.contact >= 0 && n.contact <= 1
    && n.bleed >= 0 && n.bleed <= 1 && n.hairs >= 0 && n.hairs < 20 && n.grid >= 0 && n.decay > 0;
  check(`nib ${name} params in range`, ok);
}
check('flying stays broad (wide brush that breaks up)', NIBS.flying.minW >= 8, `minW ${NIBS.flying.minW}`);
check('silk tapers thin', NIBS.silk.minW < 2, `minW ${NIBS.silk.minW}`);
check('only rubbing uses a lattice', NIB_ORDER.filter((n) => NIBS[n].grid > 0).join() === 'rubbing');
check('only flying uses hairs', NIB_ORDER.filter((n) => NIBS[n].hairs > 0).join() === 'flying');
check('only rubbing bleeds', NIB_ORDER.filter((n) => NIBS[n].bleed > 0).join() === 'rubbing');
check('only splash throws heavily', NIBS.splash.splatter === 1 && NIBS.silk.splatter === 0);

// === 3. wetness grid ======================================================
{
  const wet = new Wetness(W, H);
  const near = (v, target, tol = 1e-6) => Math.abs(v - target) <= tol;
  wet.mark(100, 100, 25, 0.9);
  check('wet inside radius', near(wet.at(105, 105), 0.9), `${wet.at(105, 105)}`);
  check('wet far away is dry', wet.at(700, 700) === 0);
  check('wet out of bounds safe', wet.at(-500, -500) === 0 && wet.at(W + 9999, H + 9999) === 0);
  check('mark is a max, not an average',
    (wet.mark(105, 105, 10, 0.3), near(wet.at(105, 105), 0.9)));
  check('a stronger mark wins', (wet.mark(105, 105, 10, 0.95), near(wet.at(105, 105), 0.95)));
  wet.mark(300, 300, 20, 0.8);
  const before = wet.at(300, 300);
  for (let i = 0; i < 30; i++) wet.dry(1 / 60);
  check('wet decays', wet.at(300, 300) < before, `${before.toFixed(3)} -> ${wet.at(300, 300).toFixed(3)}`);
  check('wet never negative', wet.data.every((v) => v >= 0));
  check('wet floors at exactly 0', (() => {
    for (let i = 0; i < 1200; i++) wet.dry(1 / 60);
    return wet.data.every((v) => v === 0);
  })());
  wet.clear();
  check('clear empties wetness', wet.data.every((v) => v === 0));
  check('wet grid sized to canvas', wet.cols === Math.ceil(W / 20) && wet.rows === Math.ceil(H / 20));
}

// === 4. flying white hairs =================================================
{
  const hairs = splayHairs(9);
  check('hair count as requested', hairs.length === 9);
  const slots = hairs.map((h) => h.slot);
  check('hair slots ordered across band', slots.every((s, i) => i === 0 || s > slots[i - 1]));
  check('hair slots inside -1..1', Math.min(...slots) > -1 && Math.max(...slots) < 1,
    `[${Math.min(...slots).toFixed(2)}, ${Math.max(...slots).toFixed(1)}]`);
  const biases = hairs.map((h) => h.bias);
  check('dropout order strictly increasing', biases.every((b, i) => i === 0 || b > biases[i - 1]));
  check('allocation is deterministic', JSON.stringify(splayHairs(9)) === JSON.stringify(splayHairs(9)));
  check('two pens get different hairs', JSON.stringify(splayHairs(9)) !== JSON.stringify(splayHairs(7)));

  let monotone = true;
  for (let c = 0; c < 20; c++) {
    const counts = [0.2, 0.4, 0.6, 0.8].map((d) => survivingHairs(hairs, d, c).length);
    if (!counts.every((n, i) => i === 0 || n <= counts[i - 1])) monotone = false;
  }
  check('fewer hairs survive as speed rises', monotone);
  check('wet brush keeps every hair', survivingHairs(hairs, 0, 0).length === 9);
  check('dry brush sheds most hairs', survivingHairs(hairs, 0.9, 0).length <= 2,
    `${survivingHairs(hairs, 0.9, 0).length} left`);
  check('survival is stable across calls (no flicker)',
    survivingHairs(hairs, 0.5, 3).map((h) => h.slot).join() === survivingHairs(hairs, 0.5, 3).map((h) => h.slot).join());
  check('different path chunks give ragged edges, not stripes',
    survivingHairs(hairs, 0.6, 0).map((h) => h.slot).join() !== survivingHairs(hairs, 0.6, 9).map((h) => h.slot).join());
  check('dryness clamps out of range', survivingHairs(hairs, -5, 0).length === 9 && survivingHairs(hairs, 5, 0).length === 0);
  // The 0.7/1.3 skew means a chunk is ~6.9px on one axis and ~12.9px on the other.
  check('pathChunk buckets into discrete cells',
    pathChunk(0, 0) === 0 && pathChunk(0, 4) === 0 && pathChunk(0, 10) === 1 && pathChunk(0, 20) === 2);
  check('sub-pixel moves stay in the same chunk', pathChunk(200, 200) === pathChunk(200.4, 200.4));
  check('chunks advance monotonically along the path', pathChunk(0, 0) < pathChunk(0, 40) && pathChunk(0, 40) < pathChunk(0, 80));
  check('hash01 in range', Array.from({ length: 200 }, (_, i) => hash01(i)).every((v) => v >= 0 && v < 1));
}


  // === 5. pen lifecycle ======================================================
{
  // Every pen field the frame loop reads must exist on a freshly created state.
  // A mistyped filter name (`fv` declared, `fy` read) threw only on the second
  // line of the velocity update, so assert the shape directly rather than
  // relying on some other assertion to surface it.
  field.clear();
  field.update([hand('shape', 100, 100, 0.9)], 1 / 60);
  const shape = field.states.get('shape');
  check('new pen state exposes every filter', !!shape
    && typeof shape.fx?.filter === 'function'
    && typeof shape.fy?.filter === 'function'
    && typeof shape.fs?.filter === 'function'
    && typeof shape.fp?.filter === 'function',
  shape ? Object.keys(shape).join(',') : 'no state');
  for (const nib of NIB_ORDER) {
    field.setNib(nib);
    let threw = null;
    try { field.update([hand('shape', 120 + Math.random() * 40, 140, 0.9)], 1 / 60); }
    catch (e) { threw = e; }
    check(`nib ${nib} runs on a live pen state`, !threw, threw ? String(threw.message) : '');
  }
  field.setNib('silk');
  field.clear();

  field.clear();
  field.setNib('silk');
  for (let i = 0; i < 40; i++) field.update([hand('a', 200 + i * 8, 300 + Math.sin(i / 4) * 40, 0.9)], 1 / 60);
  check('stroke deposits wet ink', field.wet.at(200 + 39 * 8, 300) > 0, `${field.stats.speed.toFixed(0)} px/s`);
  check('stats expose dry + drops for HUD', typeof field.stats.dry === 'number' && typeof field.stats.drops === 'number');
  check('pen reported down', field.stats.down === true);
  check('stats finite (no NaN in HUD)',
    [field.stats.speed, field.stats.width, field.stats.press, field.stats.dry].every(Number.isFinite));

  const st = field.states.get('a');
  // Curling the index is what lifts the pen, not closing the whole hand.
  for (let i = 0; i < 12; i++) field.update([hand('a', 520, 300, 0.05, 0.9)], 1 / 60);
  check('curled index lifts the pen', st.down === false, `down=${st.down} ratio=${st.indexRatio.toFixed(2)}`);
  check('lift sets pending (no bridge drawn)', st.pending === true);

  // unseen hand must not stamp at all
  const wetBefore = field.wet.at(900, 700);
  field.update([{ id: 'a', screen: { x: 900, y: 700 }, openness: 0.95, indexRatio: 1.9, seen: false }], 1 / 60);
  check('untracked hand never draws', field.wet.at(900, 700) === wetBefore);
  check('untracked hand freezes its position', st.x === 520);

  for (let i = 0; i < 12; i++) field.update([hand('a', 900, 700, 0.9)], 1 / 60);
  check('re-entry resumes', field.stats.down === true);
  check('re-entry deposits at the new spot', field.wet.at(900, 700) > 0);
  check('hairs allocated once per pen', (() => {
    field.setNib('flying');
    for (let i = 0; i < 10; i++) field.update([hand('a', 300 + i * 40, 300, 0.9)], 1 / 60);
    const h = st.hairs;
    field.update([hand('a', 800, 300, 0.9)], 1 / 60);
    return st.hairs === h;
  })());

  // two hands, two palettes, two states
  field.clear();
  field.update([hand('a', 300, 300, 0.9), hand('b', 600, 300, 0.9)], 1 / 60);
  check('two pens tracked independently', field.states.size === 2);
  check('hands get distinct ink colours',
    JSON.stringify([...field.states.values()].map((s) => s.rgb)) !== '[[111,211,255],[111,211,255]]');
  check('HUD hand count reflects both', field.states.size === 2);
  field.update([hand('a', 300, 300, 0.9)], 1 / 60);
  check('vanished pen is dropped', field.states.size === 1);
}

// === 6. droplets ===========================================================
{
  const run = (nibName, overWet, frames = 150) => {
    field.clear();
    field.setNib(nibName);
    if (overWet) field.wet.mark(600, 400, 150, 1);
    const drop = { x: 600, y: 400, vx: 900, vy: 0, r: 6, rgb: [111, 211, 255], life: 1, decay: 0.6, contact: NIBS[nibName].contact, trail: 4, landed: false };
    let alive = 0;
    for (let i = 0; i < frames; i++) {
      field.stepDrops([drop], 1 / 60, NIBS[nibName]);
      if (drop.life <= 0) break;
      alive++;
    }
    return { alive, x: drop.x, y: drop.y, life: drop.life, r: drop.r };
  };
  const wetDrop = run('splash', true);
  const dryDrop = run('splash', false);
  check('droplet travels on gravity', dryDrop.y > 400, `y ${dryDrop.y.toFixed(0)}`);
  check('droplet drifts forward', dryDrop.x > 600);
  check('wet ink kills droplets faster', wetDrop.alive < dryDrop.alive, `${wetDrop.alive} vs ${dryDrop.alive} frames`);
  check('splat shrinks the droplet', wetDrop.r < 6, `r ${wetDrop.r.toFixed(2)}`);

  const silkDrop = run('silk', true);
  check('silk contact 0 -> droplet never splats', silkDrop.r === 6, `r ${silkDrop.r}`);

  field.clear();
  field.setNib('splash');
  for (let i = 0; i < 60; i++) field.update([hand('a', 400 + i * 9, 300, 0.95)], 1 / 60);
  check('fast splash throws droplets', field.stats.drops > 0, `${field.stats.drops} droplets`);
  const slow = field.stats.drops;
  field.clear();
  for (let i = 0; i < 60; i++) field.update([hand('a', 200, 300 + i * 0.2, 0.95)], 1 / 60);
  check('slow splash throws almost none', field.stats.drops < slow, `${field.stats.drops} vs ${slow}`);

  field.drops.length = 0;
  for (let i = 0; i < 1900; i++) {
    field.drops.push({ x: 0, y: 0, vx: 0, vy: 0, r: 1, rgb: [1, 1, 1], life: 1, decay: 0, contact: 1, trail: 1, landed: true });
  }
  field.stepDrops(field.drops, 1 / 60, NIBS.splash);
  check('droplet list capped', field.drops.length <= 1400, `${field.drops.length}`);
}

// === 7. every nib survives a full simulated session =======================
for (const name of NIB_ORDER) {
  field.clear();
  field.setNib(name);
  let threw = null;
  try {
    for (let i = 0; i < 120; i++) {
      field.update([hand('a', 100 + i * 9, 400 + Math.sin(i / 3) * 90, 0.9)], 1 / 60);
      field.render(1 / 60);
      if (i % 20 === 0) field.update([hand('a', 100 + i * 9, 400, 0.15, 0.9)], 1 / 60);
      if (i % 30 === 0) field.drawCursor(field.states.get('a'));
      if (i === 60) field.setNib(NIB_ORDER[(NIB_ORDER.indexOf(name) + 1) % 4]);
      if (i === 90) field.setNib(name);
    }
    field.flatten();
  } catch (e) { threw = e; }
  check(`nib ${name} runs a full session`, !threw, threw ? String(threw.message) : '');
}

// === 8. clear / reset / resize =============================================
{
  field.clear();
  check('clear empties droplets', field.drops.length === 0);
  check('clear empties wetness', field.wet.data.every((v) => v === 0));
  check('clear empties pens', field.states.size === 0);
  check('clear resets stats', field.stats.drops === 0 && field.stats.down === false);

  field.update([hand('a', 300, 300, 0.95)], 1 / 60);
  field.drops.push({ x: 1, y: 1, vx: 0, vy: 0, r: 1, rgb: [1, 1, 1], life: 1, decay: 1, contact: 1, trail: 1, landed: true });
  field.reset();
  check('reset clears pens + droplets, keeps ink', field.drops.length === 0 && field.states.size === 0);

  field.resize(640, 480, 2);
  check('resize rebuilds wet grid for new size', field.wet.cols === Math.ceil(640 / 20) && field.wet.rows === Math.ceil(480 / 20));
  check('resize backs canvas with dpr', field.ink.width === 1280 && field.ink.height === 960);
  let threw = null;
  try {
    for (let i = 0; i < 30; i++) { field.update([hand('a', 100 + i * 9, 200, 0.9)], 1 / 60); field.render(1 / 60); }
  } catch (e) { threw = e; }
  check('drawing works after resize', !threw, threw ? String(threw.message) : '');

  field.resize(0, 0, 1);
  threw = null;
  try { field.update([hand('a', 10, 10, 0.9)], 1 / 60); field.render(1 / 60); } catch (e) { threw = e; }
  check('zero-size canvas does not throw', !threw, threw ? String(threw.message) : '');
}

// === 9. drawing actually emits geometry ===================================
{
  field.clear();
  field.setNib('silk');
  field.resize(W, H, 1);
  const before = strokes;
  for (let i = 0; i < 30; i++) field.update([hand('a', 200 + i * 10, 300, 0.9)], 1 / 60);
  check('silk emits geometry', strokes - before > 60, `${strokes - before} ops`);

  for (const name of NIB_ORDER) {
    field.clear();
    field.setNib(name);
    const b = strokes;
    for (let i = 0; i < 30; i++) field.update([hand('a', 200 + i * 14, 300, 0.9)], 1 / 60);
    check(`${name} emits geometry`, strokes - b > 20, `${strokes - b} ops`);
  }

  field.clear();
  field.setNib('rubbing');
  const g0 = gradientCalls;
  for (let i = 0; i < 20; i++) field.update([hand('a', 200 + i * 10, 300, 0.9)], 1 / 60);
  check('rubbing bleeds via gradients', gradientCalls > g0, `${gradientCalls - g0} gradients`);
  field.clear();
  field.setNib('silk');
  const g1 = gradientCalls;
  for (let i = 0; i < 20; i++) field.update([hand('a', 200 + i * 10, 300, 0.9)], 1 / 60);
  check('silk does not bleed', gradientCalls === g1, `${gradientCalls - g1} extra`);

  // degenerate segments must not divide by zero
  let threw = null;
  try { ribbon(makeCtx(makeCanvas()), 10, 10, 5, 10, 10, 5, '#fff'); } catch (e) { threw = e; }
  check('zero-length ribbon safe', !threw, threw ? String(threw.message) : '');
  threw = null;
  try {
    field.update([hand('a', 300, 300, 0.9)], 1 / 600);
    field.update([hand('a', 300, 300, 0.9)], 1 / 100000);
  } catch (e) { threw = e; }
  check('extreme dt safe', !threw, threw ? String(threw.message) : '');
  check('extreme dt leaves stats finite',
    [field.stats.speed, field.stats.width, field.stats.press].every(Number.isFinite));
}

// === 10. staked structures =================================================
{
  field.clear();
  check('every sector stakes its own kind', SECTORS.every((s) => {
    const st = field.stake(s.id, 600, 400, { seed: 2024 });
    return st.kind === s.id && st.total > 20 && KINDS.includes(s.id);
  }), `${SECTORS.length} sectors -> ${KINDS.length} kinds`);
  for (let i = 0; i < 120; i++) field.growStakes(1 / 60);
  check('structures finish growing', field.stakes.every((s) => s.grown === 1));
  field.update([hand('a', 100, 100, 0.9)], 1 / 60);
  check('HUD can read the stake count', field.stats.stakes === field.stakes.length,
    `${field.stats.stakes}`);

  field.clear();
  field.stake('lattice', 300, 300, { seed: 1 });
  field.growStakes(GROW_MS / 4000);
  const q1 = field.stakes[0].grown;
  field.growStakes(GROW_MS / 4000);
  check('growth is gradual, not instant', Math.abs(q1 - 0.25) < 1e-9 && Math.abs(field.stakes[0].grown - 0.5) < 1e-9,
    `${q1.toFixed(2)} -> ${field.stakes[0].grown.toFixed(2)}`);
  field.growStakes(100);
  check('oversized dt clamps growth to 1', field.stakes[0].grown === 1);
  check('a fully grown stake stops consuming growth', (() => {
    const before = field.stakes[0].grown;
    field.growStakes(1 / 60);
    return field.stakes[0].grown === before;
  })());

  field.clear();
  for (let i = 0; i < STAKE_LIMIT + 6; i++) field.stake('mesh', 100 + i * 8, 100 + i * 4, { seed: 7000 + i });
  check('stake list is capped', field.stakes.length === STAKE_LIMIT, `${field.stakes.length}`);
  check('newest stake kept', field.stakes[STAKE_LIMIT - 1].seed === 7000 + STAKE_LIMIT + 5);
  check('oldest stakes dropped', !field.stakes.some((s) => s.seed === 7000));

  field.clear();
  field.stake('radial', 600, 400, { seed: 55 });
  for (let i = 0; i < 120; i++) field.growStakes(1 / 60);
  // Snapshot the numbers: resize mutates the stake object in place.
  const snap = { x: field.stakes[0].x, y: field.stakes[0].y, scale: field.stakes[0].scale };
  field.resize(W / 2, H / 2, 1);
  const moved = field.stakes[0];
  check('structures survive a resize', field.stakes.length === 1);
  check('re-anchored by the viewport ratio',
    Math.abs(moved.x - snap.x / 2) < 1e-6 && Math.abs(moved.y - snap.y / 2) < 1e-6,
    `${snap.x},${snap.y} -> ${moved.x},${moved.y}`);
  check('scale follows the viewport ratio', Math.abs(moved.scale - snap.scale / 2) < 1e-9,
    `${snap.scale.toFixed(3)} -> ${moved.scale.toFixed(3)}`);
  check('restored at full growth after resize', moved.grown === 1);

  field.clear();
  field.update([hand('a', 200, 200, 0.9)], 1 / 60);
  check('clear removes every stake', field.stakes.length === 0 && field.stats.stakes === 0);

  let threw = null;
  try {
    for (let i = 0; i < 300; i++) {
      if (i % 20 === 0) field.stake(SECTORS[(i / 20) % 8 | 0].id, 200 + (i % 5) * 180, 250, { seed: i });
      field.update([hand('a', 150 + i * 3, 400 + Math.sin(i / 5) * 120, i % 7 < 4 ? 0.9 : 0.15, i % 7 < 4 ? 1.9 : 0.9)], 1 / 60);
      field.render(1 / 60);
    }
    field.flatten();
  } catch (e) { threw = e; }
  check('drawing and staking interleave cleanly', !threw, threw ? String(threw.message) : `${field.stakes.length} stakes`);
}

// === 11. two-hand field, integrated =======================================
for (const mode of ['mirror', 'attract', 'repel']) {
  field.clear();
  const fs = new FieldState();
  fs.set(mode);
  let threw = null;
  try {
    for (let i = 0; i < 120; i++) {
      const l = { x: 300 + Math.sin(i / 8) * 40, y: 400 };
      const r = { x: 900 + Math.cos(i / 8) * 40, y: 400 };
      fs.update([{ ...l, down: true }, { ...r, down: true }], 1 / 60, W, H);
      field.update([
        hand('L', fs.apply(l, r).x, fs.apply(l, r).y, 0.9),
        hand('R', fs.apply(r, l).x, fs.apply(r, l).y, 0.9),
      ], 1 / 60);
      field.render(1 / 60);
    }
    field.flatten();
  } catch (e) { threw = e; }
  check(`${mode}: 120 frames of two warped pens`, !threw, threw ? String(threw.message) : '');
  check(`${mode}: stats stay finite`,
    [field.stats.speed, field.stats.width, field.stats.press, field.stats.dry, field.stats.drops].every(Number.isFinite),
    `speed ${fmt(field.stats.speed, 0)} px/s`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);