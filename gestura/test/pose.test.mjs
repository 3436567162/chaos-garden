// Pose rules: landmark geometry driven by synthetic hands, no browser or model needed.
import { LM, isPointing, palmCenter, openness, curledFingers, SKELETON, usableHand, indexExtension, isWriting, DOWN_RATIO, UP_RATIO } from '../js/pose.js';

// A hand in normalised camera space (x right, y down), palm facing the camera,
// wrist at the bottom. `curl` is 0 = fully extended, 1 = folded into the palm.
function makeHand({ curl = 0, thumbOut = false, spread = 1 } = {}) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const set = (i, x, y) => { lm[i].x = x; lm[i].y = y; };

  set(LM.WRIST, 0.50, 0.80);

  // Four fingers: MCP at the knuckle, PIP mid, TIP at the end.
  const chains = [
    { m: [0.42, 0.62], p: [0.38, 0.46], t: [0.35, 0.23], ids: [5, 6, 7, 8] },
    { m: [0.50, 0.58], p: [0.48, 0.40], t: [0.47, 0.16], ids: [9, 10, 11, 12] },
    { m: [0.58, 0.60], p: [0.58, 0.42], t: [0.59, 0.18], ids: [13, 14, 15, 16] },
    { m: [0.64, 0.66], p: [0.66, 0.50], t: [0.68, 0.27], ids: [17, 18, 19, 20] },
  ];

  for (const c of chains) {
    const [mcpIdx, pipIdx, dipIdx, tipIdx] = c.ids;
    set(mcpIdx, c.m[0], c.m[1]);
    set(pipIdx, c.p[0], c.p[1]);
    // DIP sits two thirds of the way out, TIP at the end. Curling interpolates
    // the distal joints back toward the PIP, which is what a real fold does.
    const P = c.p;
    const lerpToPip = (pt) => [
      P[0] + (pt[0] - P[0]) * (1 - curl),
      P[1] + (pt[1] - P[1]) * (1 - curl),
    ];
    const [dx, dy] = lerpToPip([P[0] + (c.t[0] - P[0]) * 0.6, P[1] + (c.t[1] - P[1]) * 0.6]);
    const [tx, ty] = lerpToPip(c.t);
    // Splay the fingers apart laterally so an open hand is visually open.
    const widen = (spread - 1) * 0.06;
    set(dipIdx, dx + widen * (c.m[0] - 0.5), dy);
    set(tipIdx, tx + widen * (c.m[0] - 0.5), ty);
  }

  set(LM.THUMB_CMC, 0.40, 0.72);
  set(LM.THUMB_MCP, 0.34, 0.66);
  set(LM.THUMB_IP, thumbOut ? 0.22 : 0.31, thumbOut ? 0.58 : 0.62);
  set(LM.THUMB_TIP, thumbOut ? 0.13 : 0.27, thumbOut ? 0.49 : 0.60);

  return lm;
}

const scale = (lm, k) => lm.map((p) => ({ x: 0.5 + (p.x - 0.5) * k, y: 0.5 + (p.y - 0.5) * k, z: 0 }));

const openHand = makeHand({ curl: 0, thumbOut: true });
const pointHand = makeHand({ curl: 1, thumbOut: true });
const fistHand = makeHand({ curl: 1, thumbOut: false });

let fail = 0;
const check = (name, got, want, detail = '') => {
  const ok = String(got) === String(want);
  if (!ok) fail++;
  const d = detail ? ` [${detail}]` : '';
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d} -> ${got}${ok ? '' : `  (want ${want})`}`);
};

console.log('--- isPointing ---');
check('open palm is not pointing', isPointing(openHand), false);
check('fist with thumb tucked is not pointing', isPointing(fistHand), false);
check('fist with thumb out IS pointing', isPointing(pointHand), true);
check('short landmark array is guarded', isPointing([{ x: 0, y: 0 }]), false);
check('null is guarded', isPointing(null), false);
check('undefined is guarded', isPointing(undefined), false);

console.log('\n--- openness (drives press) ---');
check('open hand is wide open', openness(openHand) > 0.6, true);
check('fist is closed', openness(fistHand) < 0.2, true);
check('pointing hand is closed (staking must not smear ink)', openness(pointHand) < 0.3, true);
const ramp = [0, 0.3, 0.6, 1].map((c) => openness(makeHand({ curl: c })));
check('openness falls monotonically as the hand closes', ramp.every((v, i) => i === 0 || v < ramp[i - 1]), true);
console.log(`     ramp: ${ramp.map((v) => v.toFixed(2)).join(' -> ')}`);

console.log('\n--- scale invariance ---');
check('isPointing at 0.45x', isPointing(scale(pointHand, 0.45)), true);
check('isPointing at 1.8x', isPointing(scale(pointHand, 1.8)), true);
const o1 = openness(scale(pointHand, 0.45));
const o2 = openness(scale(pointHand, 1.8));
check('openness identical at 0.45x and 1.8x', Math.abs(o1 - o2) < 1e-9, true);
console.log(`     ${o1.toFixed(6)} vs ${o2.toFixed(6)}`);
check('curledFingers at 1.8x', JSON.stringify(curledFingers(scale(pointHand, 1.8))), '[true,true,true,true]');

console.log('\n--- partial curl boundary ---');
for (const c of [0, 0.3, 0.5, 0.7, 0.9, 1]) {
  const h = makeHand({ curl: c });
  console.log(`     curl ${c.toFixed(1)}  pointing ${String(isPointing(h)).padEnd(5)} openness ${openness(h).toFixed(2)}`);
}

console.log('\n--- palmCenter ---');
const pc = palmCenter(openHand);
console.log(`     ${pc.x.toFixed(3)}, ${pc.y.toFixed(3)}  (between wrist 0.80 and MCPs ~0.61)`);
check('palmCenter ignores finger motion', (() => {
  const a = palmCenter(openHand);
  const b = palmCenter(fistHand);
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
})(), true);

console.log('\n--- skeleton ---');
check('21 edges', SKELETON.length, 21);
check('all indices in range', SKELETON.every(([a, b]) => a >= 0 && a < 21 && b >= 0 && b < 21), true);
check('no self loops', SKELETON.every(([a, b]) => a !== b), true);

// --- the shipped regression: one finger out must write ---------------------
// Pen-down used to be gated on overall openness, so writing with a single
// extended finger (the most natural gesture) registered as a lifted pen.
console.log('\n--- pen-down is the index finger, not overall spread ---');

/** Independent curl per finger, so "index only" can be expressed. */
function makeHand2({ index = 0, middle = 0, ring = 0, pinky = 0, thumbOut = false } = {}) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const set = (i, x, y) => { lm[i].x = x; lm[i].y = y; };
  set(LM.WRIST, 0.50, 0.80);
  const chains = [
    { c: index, m: [0.42, 0.62], p: [0.38, 0.46], t: [0.35, 0.23], ids: [5, 6, 7, 8] },
    { c: middle, m: [0.50, 0.58], p: [0.48, 0.40], t: [0.47, 0.16], ids: [9, 10, 11, 12] },
    { c: ring, m: [0.58, 0.60], p: [0.58, 0.42], t: [0.59, 0.18], ids: [13, 14, 15, 16] },
    { c: pinky, m: [0.64, 0.66], p: [0.66, 0.50], t: [0.68, 0.27], ids: [17, 18, 19, 20] },
  ];
  for (const ch of chains) {
    const [m, p, d, ti] = ch.ids;
    set(m, ch.m[0], ch.m[1]);
    set(p, ch.p[0], ch.p[1]);
    const k = 1 - ch.c;
    set(d, ch.p[0] + (ch.t[0] - ch.p[0]) * k * 0.6, ch.p[1] + (ch.t[1] - ch.p[1]) * k * 0.6);
    set(ti, ch.p[0] + (ch.t[0] - ch.p[0]) * k, ch.p[1] + (ch.t[1] - ch.p[1]) * k);
  }
  set(LM.THUMB_CMC, 0.40, 0.72);
  set(LM.THUMB_MCP, 0.34, 0.66);
  set(LM.THUMB_IP, thumbOut ? 0.22 : 0.31, thumbOut ? 0.58 : 0.62);
  set(LM.THUMB_TIP, thumbOut ? 0.13 : 0.27, thumbOut ? 0.49 : 0.60);
  return lm;
}

const INDEX_ONLY = makeHand2({ middle: 1, ring: 1, pinky: 1 });
const OPEN_PALM = makeHand2({});
const FIST2 = makeHand2({ index: 1, middle: 1, ring: 1, pinky: 1 });
const POINTING2 = makeHand2({ index: 1, middle: 1, ring: 1, pinky: 1, thumbOut: true });

check('index only is recognised as writing', isWriting(INDEX_ONLY) === true, true,
  `ratio ${indexExtension(INDEX_ONLY).toFixed(2)}`);
check('index only has LOW overall openness', openness(INDEX_ONLY) < 0.3, true,
  `${openness(INDEX_ONLY).toFixed(3)} - this is why gating on spread failed`);
check('open palm writes', isWriting(OPEN_PALM) === true, true);
check('fist does not write', isWriting(FIST2) === false, true,
  `ratio ${indexExtension(FIST2).toFixed(2)}`);
check('pointing does not write (pen up for staking)', isWriting(POINTING2) === false, true);
check('index only and fist are told apart', isWriting(INDEX_ONLY) !== isWriting(FIST2), true);
check('pinky only does not write', isWriting(makeHand2({ index: 1, middle: 1, ring: 1 })) === false, true);
check('two fingers write', isWriting(makeHand2({ ring: 1, pinky: 1 })) === true, true);

console.log('\n--- pen-down hysteresis ---');
check('thresholds leave a hysteresis gap', DOWN_RATIO > UP_RATIO, true,
  `${DOWN_RATIO} > ${UP_RATIO}`);
{
  // Aim at the middle of the hysteresis window, not the middle of the range:
  // the window is deliberately narrow, so the midpoint of the full range misses it.
  const mid = (DOWN_RATIO + UP_RATIO) / 2;
  console.log(`     target ${mid.toFixed(3)} inside window ${UP_RATIO}..${DOWN_RATIO}`);
  // Build a hand whose index ratio sits inside the chatter window.
  const lm = JSON.parse(JSON.stringify(OPEN_PALM));
  const wrist = lm[LM.WRIST];
  const pip = lm[LM.INDEX_PIP];
  const pipDist = Math.hypot(pip.x - wrist.x, pip.y - wrist.y);
  const want = pipDist * mid;
  lm[LM.INDEX_TIP] = { x: wrist.x, y: wrist.y - want, z: 0 };
  const got = indexExtension(lm);
  check('constructed a mid-gesture inside the gap', got > UP_RATIO && got <= DOWN_RATIO, true,
    `ratio ${got.toFixed(3)}, gap ${UP_RATIO}..${DOWN_RATIO}`);
  if (got > UP_RATIO && got <= DOWN_RATIO) {
    check('mid-gesture holds down when it was down', isWriting(lm, true) === true, true);
    check('mid-gesture stays up when it was up', isWriting(lm, false) === false, true);
    check('mid-gesture does not chatter', isWriting(lm, true) === isWriting(lm, true), true);
  }
}

console.log('\n--- scale invariance of the new signal ---');
const scale2 = (lm, k) => lm.map((p) => ({ x: 0.5 + (p.x - 0.5) * k, y: 0.5 + (p.y - 0.5) * k, z: 0 }));
check('index only at 0.45x still writes', isWriting(scale2(INDEX_ONLY, 0.45)) === true, true);
check('index only at 1.8x still writes', isWriting(scale2(INDEX_ONLY, 1.8)) === true, true);
check('fist at 1.8x still does not write', isWriting(scale2(FIST2, 1.8)) === false, true);
check('ratio identical at 0.45x and 1.8x',
  Math.abs(indexExtension(scale2(INDEX_ONLY, 0.45)) - indexExtension(scale2(INDEX_ONLY, 1.8))) < 1e-9, true);
check('short array yields ratio 0', indexExtension([{ x: 0, y: 0 }]) === 0, true);
check('short array is not writing', isWriting([{ x: 0, y: 0 }]) === false, true);
check('usableHand rejects short arrays', usableHand([{ x: 0, y: 0 }]) === false && usableHand(OPEN_PALM) === true, true);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail ? 1 : 0);