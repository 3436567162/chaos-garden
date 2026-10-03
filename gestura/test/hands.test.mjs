// hands.js coverage, including the scope bug this file exists to prevent.
//
// `export { X } from './y.js'` does not bind X locally. hands.js relied on that
// for `LM` and threw "LM is not defined" inside #acquire — a path that only runs
// when a hand is actually detected, so it presented as a hand-tracking freeze
// rather than a module error.
//
// Every assertion runs in Node against a stubbed MediaPipe module, which is
// also why this file exists: hands.js was the one module with zero coverage.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// Make the bare CDN specifier resolvable without an npm install.
const pkgDir = join(root, 'node_modules', '@mediapipe', 'tasks-vision');
if (!existsSync(pkgDir)) mkdirSync(pkgDir, { recursive: true });
writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
  name: '@mediapipe/tasks-vision',
  version: '0.0.0-stub',
  type: 'module',
  main: 'index.js',
  exports: { '.': './index.js' },
}, null, 2));
writeFileSync(
  join(pkgDir, 'index.js'),
  `export * from ${JSON.stringify(pathToFileURL(join(here, 'stubs', 'tasks-vision.js')).href)};\n`,
);

const { HandTracker } = await import('../js/hands.js');
const { LM } = await import('../js/pose.js');
const stub = await import('./stubs/tasks-vision.js');

let fail = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ->  ' + detail : ''}`);
};

const ident = (p) => ({ x: p.x * 100, y: p.y * 100 });

/** A tracker wired to a fake video element and a scripted detector. */
function makeTracker({ landmarks = [], handedness = null } = {}) {
  const t = new HandTracker({ maxHands: 2 });
  t.video = { videoWidth: 640, videoHeight: 480, readyState: 4, currentTime: 0, play: async () => {} };
  t.landmarker = {
    detectForVideo: () => ({
      landmarks,
      handedness: handedness ?? landmarks.map(() => [{ categoryName: 'Left', score: 0.9 }]),
    }),
  };
  t.landmarker.detectCalls = 0;
  const real = t.landmarker.detectForVideo.bind(t.landmarker);
  t.landmarker.detectForVideo = (v, ts) => { t.landmarker.detectCalls++; return real(v, ts); };
  return t;
}

/** 21 points; wristX drives identity matching, so it is a parameter. */
function hand(wristX, label = 'Left') {
  const lm = Array.from({ length: 21 }, (_, i) => ({ x: wristX + i * 0.004, y: 0.5, z: 0 }));
  lm[LM.WRIST] = { x: wristX, y: 0.8, z: 0 };
  return { lm, label };
}

// === the shipped regression ================================================
check('pose.js exposes LM', typeof LM === 'object' && LM.WRIST === 0);
check('#acquire reads LM.WRIST without throwing', (() => {
  const h = hand(0.4);
  const t = makeTracker({ landmarks: [h.lm], handedness: [[{ categoryName: h.label, score: 0.9 }]] });
  try {
    t.update(1, ident);
    return t.hands.length === 1;
  } catch (e) {
    console.log('     threw: ' + e.message);
    return false;
  }
})());

// === detection cycle =======================================================
{
  // Distinct handedness labels so identity tracking keeps them separate: two
  // same-labelled hands at the same wrist position are one hand by design.
  const a = hand(0.30, 'Left');
  const b = hand(0.62, 'Right');
  const t = makeTracker({
    landmarks: [a.lm, b.lm],
    handedness: [[{ categoryName: 'Left' }], [{ categoryName: 'Right' }]],
  });
  t.update(1, ident);
  check('two distinct hands detected', t.hands.length === 2, `${t.hands.length}`);
  check('raw model count exposed', t.rawLandmarks === 2, `${t.rawLandmarks}`);
  check('screen projection applied', typeof t.hands[0].screen.x === 'number');
  check('detecting flag set', t.detecting === true);
  check('detector called once', t.landmarker.detectCalls === 1, `${t.landmarker.detectCalls}`);

  t.update(2, ident);
  check('same camera frame not re-detected', t.skipped === 'newer-frame-pending' && t.landmarker.detectCalls === 1);

  t.video.currentTime = 2;
  t.update(3, ident);
  check('new frame is detected', t.landmarker.detectCalls === 2);
}

{
  // Same label and a wrist within the match radius is one hand, not two.
  const t = makeTracker({ landmarks: [hand(0.40).lm, hand(0.42).lm] });
  t.update(1, ident);
  check('nearby same-label hands merge into one', t.hands.length === 1, `${t.hands.length}`);

  const far = makeTracker({ landmarks: [hand(0.20).lm, hand(0.70).lm] });
  far.update(1, ident);
  check('distant same-label hands stay separate', far.hands.length === 2, `${far.hands.length}`);
}

{
  const a = hand(0.3, 'Left');
  const t = makeTracker({ landmarks: [a.lm], handedness: [[{ categoryName: 'Left' }]] });
  t.update(1, ident);
  const id0 = t.hands[0].id;
  t.video.currentTime = 2;
  t.update(2, ident);
  check('hand id survives a new frame', t.hands[0]?.id === id0, `${id0}`);

  t.landmarker.detectForVideo = () => ({ landmarks: [], handedness: [] });
  for (let i = 0; i < 14; i++) {
    t.video.currentTime = 3 + i;
    t.update(100 + i, ident);
  }
  check('hand dropped after the gap window', t.hands.length === 0, `${t.hands.length} left`);
}

// === skip reasons are visible, never silent ================================
{
  const a = hand(0.3);
  const t = makeTracker({ landmarks: [a.lm] });
  t.update(1, ident);
  const fresh = t.inferenceMs;
  t.video.videoWidth = 2;
  t.video.currentTime = 5;
  t.update(2, ident);
  check('tiny frame skipped with a reason', t.skipped === 'tiny-frame', `${t.skipped}`);
  check('skipped frame clears stale timing', t.inferenceMs === 0, `was ${fresh}`);
  check('detecting false while skipping', t.detecting === false);
}
{
  const t = makeTracker({});
  t.video.readyState = 1;
  t.update(1, ident);
  check('no video reported with a reason', t.skipped === 'no-video', `${t.skipped}`);
}

// === detection failures degrade, never propagate ===========================
{
  stub.reset();
  const t = new HandTracker({ maxHands: 2 });
  await t.init();
  check('init prefers GPU', t.delegate === 'GPU', `${t.delegate}`);
  check('init shares one confidence value', t.confidence === 0.3, `${t.confidence}`);

  t.video = { videoWidth: 640, videoHeight: 480, readyState: 4, currentTime: 0 };
  t.landmarker.detectForVideo = () => { throw new Error('WebGL context lost'); };

  let threw = false;
  try {
    for (let i = 0; i < 30; i++) { t.video.currentTime = i; t.update(i, ident); }
  } catch { threw = true; }
  check('a throwing detector never escapes update()', !threw);
  check('failure message recorded', /WebGL/.test(String(t.lastError)), `${t.lastError}`);
  check('failure counted', t.failStreak === 30, `${t.failStreak}`);
  check('CPU fallback scheduled at the threshold', t.pendingFallback === true);

  const before = t.delegate;
  const ok = await t.applyFallback();
  check('fallback rebuilds on CPU', ok && t.delegate === 'CPU', `${before} -> ${t.delegate}`);
  check('fallback clears failure state', t.failStreak === 0 && t.pendingFallback === false);
  check('fallback discards stale hand ids', t.hands.length === 0 && t.lastVideoTime === -1);
}

{
  const a = hand(0.3);
  const t = makeTracker({ landmarks: [a.lm] });
  t.landmarker.detectForVideo = () => { throw new Error('Packet timestamp mismatch'); };
  for (let i = 0; i < 5; i++) { t.video.currentTime = i; t.update(i, ident); }
  check('duplicate timestamp is a skip, not a failure', t.skipped === 'duplicate-timestamp', `${t.skipped}`);
  check('timestamp noise does not trigger fallback', t.pendingFallback === false);
}

// === delegate switching ====================================================
{
  stub.reset();
  const t = new HandTracker({ maxHands: 2 });
  await t.init();
  const n = stub.created.length;
  check('init created one landmarker', n === 1);
  await t.setDelegate('CPU');
  check('setDelegate rebuilds', stub.created.length === n + 1);
  check('setDelegate closes the old landmarker', stub.created[0].closed === true);
  check('setDelegate switches to CPU', t.delegate === 'CPU');
  await t.setDelegate('CPU');
  check('same backend is a no-op', stub.created.length === n + 1);
}

// === warm-up =================================================================
{
  const t = makeTracker({});
  t.video.videoWidth = 640;
  check('warmUp runs when a usable frame exists', t.warmUp() === true);
  check('warmUp records its cost', t.warmUpMs >= 0);
  check('warmUp marks itself warmed', t.warmed === true);

  const tiny = makeTracker({});
  tiny.video.videoWidth = 2;
  check('warmUp refuses a placeholder frame', tiny.warmUp() === false);

  const bare = new HandTracker({});
  check('warmUp refuses with no video', bare.warmUp() === false);
}

// === video size reporting ===================================================
{
  const t = makeTracker({});
  check('videoSize reports geometry', t.videoSize === '640x480', t.videoSize);
  const none = new HandTracker({});
  check('videoSize is safe with no video', none.videoSize === '—');
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail ? 1 : 0);