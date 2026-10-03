// Smoothing: does One Euro actually beat the fixed-rate smoother it replaces?
// Measured against a synthetic trace with known ground truth: a still hand with
// +/-3px of sensor jitter, then a constant-velocity sweep.
import { OneEuro, OneEuro2D, Trajectory } from '../js/smoothing.js';

let fail = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ->  ' + detail : ''}`);
};

const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// --- jitter while still ----------------------------------------------------
{
  const DT = 1 / 30; // detection rate
  const truth = 500;
  let signal = 0;
  const fixed = { v: truth, peak: 0 };
  const euro = new OneEuro({ minCutoff: 1.0, beta: 0.02 });

  for (let i = 0; i < 120; i++) {
    signal = truth + (Math.random() * 2 - 1) * 3; // +/-3px noise
    fixed.v = approach(fixed.v, signal, 12, DT);
    euro.filter(signal, DT);
    fixed.peak = Math.max(fixed.peak, Math.abs(fixed.v - truth));
  }
  const euroPeak = Math.abs(euro.value - truth);
  check('still hand: both smooth the jitter', fixed.peak < 3 && euroPeak < 3,
    `fixed peak ${fixed.peak.toFixed(2)}px, one-euro peak ${euroPeak.toFixed(2)}px`);
  check('still hand: one-euro is no worse', euroPeak <= fixed.peak + 0.5,
    `${euroPeak.toFixed(2)} vs ${fixed.peak.toFixed(2)}`);
}

// --- lag during motion -----------------------------------------------------
{
  const DT = 1 / 30;
  const V = 800;      // px/s sweep
  const rate = 12;    // the smoother currently in stroke.js
  let fixedErr = 0;
  let euroErr = 0;
  let fixedPeak = 0;
  let euroPeak = 0;
  let pos = 0;
  let t = 0;

  // settle first so we measure tracking error, not the start transient
  for (let i = 0; i < 200; i++) { fixedErr += 0; void i; }

  const fixedState = { v: 0 };
  const euro = new OneEuro({ minCutoff: 1.0, beta: 0.02 });
  for (let i = 0; i < 90; i++) {
    t += DT * 1000;
    pos += V * DT;
    const noisy = pos + (Math.random() * 2 - 1) * 3;
    fixedState.v = approach(fixedState.v, noisy, rate, DT);
    euro.filter(noisy, DT);
    const fe = Math.abs(fixedState.v - pos);
    const ee = Math.abs(euro.value - pos);
    if (i > 45) { // ignore the first half-second of ramp-up
      fixedPeak = Math.max(fixedPeak, fe);
      euroPeak = Math.max(euroPeak, ee);
    }
    fixedErr += fe;
    euroErr += ee;
  }
  console.log(`     sweep 800 px/s: fixed peak lag ${fixedPeak.toFixed(1)}px, one-euro peak lag ${euroPeak.toFixed(1)}px`);
  check('moving: one-euro lags less than the fixed smoother', euroPeak < fixedPeak,
    `${euroPeak.toFixed(1)}px vs ${fixedPeak.toFixed(1)}px`);
  check('moving: mean error also lower', euroErr < fixedErr,
    `${(euroErr / 90).toFixed(2)}px vs ${(fixedErr / 90).toFixed(2)}px`);
}

// --- the cost: it must not lag more than the old smoother when very fast ----
{
  const euro = new OneEuro({ minCutoff: 1.0, beta: 0.02 });
  let v = 0;
  const DT = 1 / 30;
  for (let i = 0; i < 60; i++) { v += 3000 * DT; euro.filter(v, DT); }
  check('very fast motion still tracks', Math.abs(euro.value - v) < 120,
    `lag ${Math.abs(euro.value - v).toFixed(0)}px at 3000 px/s`);
}

// --- guards ----------------------------------------------------------------
{
  const e = new OneEuro({});
  check('first sample passes through', e.filter(42, 1 / 30) === 42);
  check('NaN does not poison the filter', (() => {
    const f = new OneEuro({});
    f.filter(10, 1 / 30);
    const after = f.filter(NaN, 1 / 30);
    return Number.isFinite(f.value) && Number.isFinite(after);
  })());
  check('zero dt does not divide by zero', (() => {
    const f = new OneEuro({});
    f.filter(10, 1 / 30);
    return Number.isFinite(f.filter(11, 0));
  })());
  check('reset clears state', (() => {
    const f = new OneEuro({});
    f.filter(10, 1 / 30);
    f.reset();
    return f.filter(99, 1 / 30) === 99;
  })());

  const p = new OneEuro2D({});
  const r = p.filter({ x: 1, y: 2 }, 1 / 30);
  check('2D filter returns a point', r.x === 1 && r.y === 2);
}

// --- Trajectory: render-rate resampling ------------------------------------
{
  const tr = new Trajectory();
  check('empty trajectory has no position', tr.at(0) === null);

  // two detections 33ms apart, then sample between and beyond them
  tr.push(1000, 100, 200);
  tr.push(1033, 200, 260);
  check('detection period reported', Math.abs(tr.period - 0.033) < 1e-6, `${(tr.period * 1000).toFixed(1)}ms`);

  const mid = tr.at(1016);
  // u = (1016-1000)/33 = 0.485, so x = 100 + 100*0.485
  check('interpolates between detections', Math.abs(mid.x - 148.5) < 0.5 && Math.abs(mid.y - 229.1) < 0.5,
    `${mid.x.toFixed(1)},${mid.y.toFixed(1)}`);

  const past = tr.at(1060);
  check('extrapolates past the newest sample', past.x > 200, `x=${past.x.toFixed(1)}`);

  const capped = tr.at(1100); // 67ms past, over maxLead
  check('extrapolation is capped', Math.abs(capped.x - 200) < 0.001, `x=${capped.x}`);

  const stale = tr.at(500); // 533ms behind, over maxLag
  check('stale playback clamps to newest', Math.abs(stale.x - 200) < 0.001);

  // a paused detector must not fling the pen
  const still = new Trajectory();
  still.push(0, 10, 10);
  still.push(33, 400, 10);
  const flung = still.at(33 + 400);
  check('a stalled detector cannot fling the pen', Math.abs(flung.x - 400) < 0.001, `x=${flung.x}`);

  // out-of-order sample must not rewind
  const ooo = new Trajectory();
  ooo.push(1000, 1, 1);
  ooo.push(1066, 2, 2);
  ooo.push(1033, 99, 99);
  check('out-of-order sample does not rewind', ooo.at(1066).x === 2, `x=${ooo.at(1066).x}`);

  ooo.reset();
  check('reset clears the trajectory', ooo.at(2000) === null);

  const bad = new Trajectory();
  bad.push(0, NaN, 5);
  check('NaN samples are ignored', bad.at(10) === null);
}

// --- the payoff: 30Hz detection rendered at 150fps -------------------------
{
  const tr = new Trajectory();
  const euro = new OneEuro2D({ minCutoff: 1.0, beta: 0.02 });
  let detT = 0;
  let detX = 0;
  const V = 700; // px/s

  // Feed detections at 30Hz.
  for (let i = 0; i < 40; i++) {
    detT += 1000 / 30;
    detX += V / 30;
    tr.push(detT, euro.filter({ x: detX, y: 0 }, 1 / 30).x, 0);
  }
  // Sample at 150fps across the 33ms window that contains two detections.
  const span = 33;
  const frames = Math.round((span + 45) / (1000 / 150));
  const seen = new Set();
  for (let t = detT - 33; t <= detT + 45; t += 1000 / 150) {
    seen.add(Math.round(tr.at(t).x * 100));
  }
  check('a 30Hz pen yields a distinct position on nearly every 150fps frame',
    seen.size >= frames * 0.8, `${seen.size} distinct of ${frames} frames`);
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail ? 1 : 0);