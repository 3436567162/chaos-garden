import { HandTracker, SKELETON, LM, isPointing, palmCenter, usableHand } from './hands.js';
import { InkField, NIBS } from './stroke.js';
import { HoldTracker, thumbAngleDeg } from './anchor.js';
import { FieldState, FIELDS } from './field.js';
import { clamp, fitCover, fmt, downloadCanvas, timestamp, lerp } from './util.js';
import { OneEuro, Trajectory } from './smoothing.js';

const canvas = document.getElementById('ink');
const video = document.getElementById('camera');
const gate = document.getElementById('gate');
const gateErr = document.getElementById('gate-err');
const pv = document.getElementById('pv');
const pvState = document.getElementById('pv-state');
const preview = document.getElementById('preview');
const pvDiag = document.getElementById('pv-diag');

const m = {
  fps: document.getElementById('m-fps'),
  res: document.getElementById('m-res'),
  gpu: document.getElementById('m-gpu'),
  cam: document.getElementById('m-cam'),
  camfps: document.getElementById('m-camfps'),
  hintRow: document.getElementById('m-hint-row'),
  hint: document.getElementById('m-hint'),
  hands: document.getElementById('m-hands'),
  speed: document.getElementById('m-speed'),
  width: document.getElementById('m-width'),
  press: document.getElementById('m-press'),
  dry: document.getElementById('m-dry'),
  drops: document.getElementById('m-drops'),
  nib: document.getElementById('m-nib'),
  stakes: document.getElementById('m-stakes'),
  hold: document.getElementById('m-hold'),
  field: document.getElementById('m-field'),
  bar: document.getElementById('m-bar'),
  holdBar: document.getElementById('m-hold-bar'),
};

const field = new InkField(canvas);
const tracker = new HandTracker({ maxHands: 2 });
const holds = new HoldTracker();
const twoHand = new FieldState();
const pvCtx = pv.getContext('2d');

let running = false;
let showPreview = false;
let showChrome = true;
let fullscreen = false;
let lastT = 0;
let lastDt = 1 / 60;
let fpsEma = 0;
let toastUntil = 0;
let holdProgress = 0;
let cover = { scale: 1, ox: 0, oy: 0, vw: 0, vh: 0 };

/** Normalised landmark (0..1, camera space) -> CSS pixels on the canvas. */
function project(p) {
  return {
    x: cover.ox + (1 - p.x) * cover.w, // mirrored: the view behaves like a mirror
    y: cover.oy + p.y * cover.h,
  };
}

/**
 * Adaptive resolution.
 *
 * Both layers are composited full-screen every frame, so the cost scales with
 * the backing store: at 3840x2160 with dpr 2 the two blits move 66 Mpx per
 * frame (~4 Gpx/s at 60fps), which alone can peg a laptop GPU and make the whole
 * page feel locked up.
 *
 * `res` is the absolute backing scale — 1 means one device pixel per CSS pixel,
 * *not* the display's dpr. Conflating the two is how a "start conservative"
 * policy ends up starting at full dpr anyway.
 */
const RES_MIN = 0.5;
const RES_MAX = 2;
// Per-layer backing budget. Two layers are composited every frame, so this is
// really a 2x budget on pixel traffic; 4 Mpx keeps an integrated GPU at roughly
// 0.5 Gpx/s.
const RES_BUDGET_MPX = 4;
const RES_TARGET_MS = 11;   // leave room for inference inside a 16.7ms frame
const RES_SETTLE = 90;      // frames to wait before adjusting again

let res = 1;
let resFrames = 0;
let resAnnounced = false;

/** Pick a starting scale from the viewport, so a 4K screen never starts at 4K. */
function initialRes() {
  const dpr = window.devicePixelRatio || 1;
  const cssMpx = (window.innerWidth * window.innerHeight) / 1e6;
  const fits = Math.sqrt(RES_BUDGET_MPX / Math.max(cssMpx, 0.01));
  return clamp(fits, RES_MIN, Math.min(dpr, RES_MAX));
}

const targetRes = () => clamp(res, RES_MIN, Math.min(window.devicePixelRatio || 1, RES_MAX));

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  field.resize(w, h, targetRes());
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  cover = fitCover(vw, vh, w, h);
  cover.vw = vw;
  cover.vh = vh;
  pv.width = 224;
  pv.height = Math.round((224 * vh) / vw) || 126;
}

/** Nudge the render scale toward whatever the frame budget can actually hold. */
function adaptRes(frameMs) {
  if (++resFrames < RES_SETTLE) return;
  resFrames = 0;
  const before = res;
  if (frameMs > RES_TARGET_MS * 1.35) res = Math.max(RES_MIN, res - 0.25);
  else if (frameMs < RES_TARGET_MS * 0.55) res = Math.min(2, res + 0.25);
  if (res !== before) {
    field.resize(window.innerWidth, window.innerHeight, targetRes());
    if (resAnnounced) toast(`渲染分辨率 ${fmt(targetRes(), 2)}x`);
    resAnnounced = true;
  }
}

function setNib(name) {
  field.setNib(name);
  for (const b of document.querySelectorAll('#toolbar [data-nib]')) {
    b.setAttribute('aria-pressed', String(b.dataset.nib === name));
  }
  m.nib.textContent = NIBS[name].label;
}

function setField(id) {
  twoHand.set(id);
  for (const b of document.querySelectorAll('#toolbar [data-field]')) {
    b.setAttribute('aria-pressed', String(b.dataset.field === twoHand.mode));
  }
  m.field.textContent = FIELDS.find((f) => f.id === twoHand.mode).label;
}

function toast(text) {
  m.press.textContent = text;
  toastUntil = performance.now() + 1600;
}

function setPreview(on) {
  showPreview = on;
  preview.classList.toggle('hidden', !on);
  document.getElementById('btn-preview').setAttribute('aria-pressed', String(on));
}

const say = (t) => {
  const b = gate.querySelector('button');
  b.disabled = false;
  b.textContent = t;
};

async function start() {
  gateErr.textContent = '';
  gate.querySelector('button').disabled = true;
  say('正在唤醒模型…');
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('此浏览器不支持 getUserMedia。请用桌面版 Chrome / Edge 打开,或改用 https / localhost。');
    }
    await tracker.init();

    // Pay the first-inference cost here, while the gate is still covering the
    // page. On the GPU delegate this is ~3.8 s of shader compilation on the
    // main thread; doing it after the gate lifts freezes the canvas exactly
    // when the user starts expecting to draw.
    say('正在打开摄像头…');
    await tracker.openCamera(video);

    say('正在编译推理管线…');
    // Yield first so the label actually paints — otherwise the browser never
    // gets a frame and the user stares at the previous text for 4 seconds.
    await new Promise((r) => requestAnimationFrame(r));
    // Bounded: warmUp() returns false while the camera has no usable frame, and
    // a camera that never reports one must not hang the loading screen.
    const warmDeadline = performance.now() + 6000;
    while (!tracker.warmUp() && performance.now() < warmDeadline) {
      await new Promise((r) => setTimeout(r, 32));
    }

    res = initialRes();
    resize();
    window.addEventListener('resize', resize);
    if (tracker.delegate === 'CPU') {
      gateErr.textContent = `GPU 推理不可用，已回退到 CPU（约 28 ms/帧 ≈ 36fps）。原因：${tracker.gpuError}`;
    } else if (tracker.sizeNote) {
      gateErr.textContent = tracker.sizeNote;
    }
    gate.classList.add('gone');
    setTimeout(() => (gate.style.display = 'none'), 700);
    setPreview(true);
    running = true;
    lastT = performance.now();
    requestAnimationFrame(loop);
  } catch (err) {
    const msg = String(err?.message || err);
    // A stale ES module surfaces as an ordinary TypeError about one method
    // missing, which points nowhere near the real cause. Say so instead.
    const stale = /is not a function|Cannot read propert/.test(msg);
    gateErr.textContent = stale
      ? `${msg}\n\n这通常意味着浏览器缓存了旧的 js 模块。用 python serve.py 启动（已禁用缓存）后 Ctrl+F5 硬刷新。`
      : msg;
    say('重试');
  }
}

function loop(now) {
  if (!running) return;
  // A throw anywhere in here used to end the rAF chain permanently: the page
  // froze on the last drawn frame with the error visible only in the console.
  // One bad frame must never be able to kill the app.
  try {
    frame(now);
  } catch (err) {
    reportFrameError(err);
  } finally {
    if (running) requestAnimationFrame(loop);
  }
}

let lastFrameError = null;
let frameErrorCount = 0;
let frameErrorAt = null;

function reportFrameError(err) {
  const msg = String(err?.message || err);
  if (msg !== lastFrameError) {
    lastFrameError = msg;
    frameErrorCount = 0;
    console.error('[gestura] frame error:', err);
    document.title = `⚠ ${msg.slice(0, 60)}`;
  }
  frameErrorCount++;
  // Surface the actual message and its stack, not a bare count: a count alone
  // cannot be acted on, and guessing at the cause from "N errors" is what made
  // this take so many rounds.
  const where = (err?.stack || '').split('\n')[1]?.trim() || '';
  frameErrorAt = where;
  m.hintRow.hidden = false;
  m.hint.textContent = `${msg.slice(0, 48)} @ ${where.replace(/https?:\/\/[^ )]*\//, '')}`;
  // Deliberately no longer stops the loop.
}

function frame(now) {
  const frameStart = performance.now();
  // A failing GPU delegate schedules its own CPU rebuild; never do it mid-frame.
  if (tracker.pendingFallback) {
    tracker.applyFallback().then((ok) => {
      if (ok) toast('已回退 CPU 推理');
    });
  }
  const dt = clamp((now - lastT) / 1000, 1 / 240, 0.1);
  lastT = now;
  fpsEma = fpsEma ? lerp(fpsEma, 1 / dt, 0.08) : 1 / dt;

  if (video.videoWidth && (video.videoWidth !== cover.vw || video.videoHeight !== cover.vh)) resize();

  lastDt = dt;
  const hands = resampleAtRenderRate(tracker.update(now, project), now);
  readGestures(hands, now);
  const pens = applyField(hands, dt);

  field.update(pens, dt);
  field.render(dt);
  for (const st of field.states.values()) field.drawCursor(st);
  if (showPreview) drawPreview(hands);

  const s = field.stats;
  // Report the detection path honestly: a skipped frame must never leave the
  // previous inference time on screen looking like a live measurement.
  const live = tracker.detecting;
  m.fps.textContent = live
    ? `${fmt(fpsEma, 0)} fps · ${fmt(tracker.inferenceMs, 0)} ms`
    : `— · ${tracker.skipped === 'newer-frame-pending' ? '等待新帧' : '未检测'}`;
  m.res.textContent = `${fmt(targetRes(), 2)}x`;
  m.gpu.textContent = `${tracker.delegate ?? '—'}${tracker.warmUpMs > 200 ? ` · 预热 ${fmt(tracker.warmUpMs / 1000, 1)}s` : ''}`;
  m.cam.textContent = tracker.videoSize;
  m.camfps.textContent = `${fmt(tracker.fps(), 0)}/s`;

  // Actionable reason for "nothing is drawing", instead of leaving the user to
  // guess at a black canvas.
  let hint = '';
  if (tracker.lastError) hint = `检测失败×${tracker.failStreak}`;
  else if (tracker.skipped === 'tiny-frame') hint = '画面尺寸无效';
  else if (tracker.skipped === 'no-video') hint = '摄像头未就绪';
  else if (tracker.rawLandmarks === 0) hint = '模型没找到手';
  else if (hands.length === 0) hint = '手靠近些·正对摄像头';
  m.hintRow.hidden = !hint;
  if (hint) m.hint.textContent = hint;
  m.hands.textContent = `${hands.length} / ${tracker.rawLandmarks ?? 0}`;
  m.speed.textContent = `${fmt(s.speed, 0)} px/s`;
  m.width.textContent = `${fmt(s.width, 1)} px`;
  if (now > toastUntil) m.press.textContent = s.down ? '落墨' : '抬笔';
  m.dry.textContent = `${fmt(s.dry * 100, 0)}%`;
  m.drops.textContent = String(s.drops);
  m.stakes.textContent = String(s.stakes);
  m.bar.style.width = `${clamp(s.press * 100, 0, 100)}%`;
  m.holdBar.style.width = `${clamp(holdProgress * 100, 0, 100)}%`;

  adaptRes(performance.now() - frameStart);
}

/**
 * Detection only runs when the camera delivers a new frame — 30/s typically —
 * while the page renders far more often. Using the raw detection point makes
 * the pen step 30 times a second no matter the render rate, which reads as
 * stutter even at 150 fps.
 *
 * So: filter the sparse detections with One Euro, then resample the trajectory
 * at render time. Interpolation gives a smooth path between detections;
 * a small capped extrapolation hides the detector's own latency. The cap
 * matters — without it a paused detector would fling the pen off screen.
 */
const euroX = new OneEuro({ minCutoff: 1.4, beta: 0.03 });
const euroY = new OneEuro({ minCutoff: 1.4, beta: 0.03 });
const traj = new Map();

function resampleAtRenderRate(hands, now) {
  const live = new Set();
  for (const hand of hands) {
    live.add(hand.id);
    if (!hand.screen) continue;
    let t = traj.get(hand.id);
    if (!t) { t = new Trajectory(); traj.set(hand.id, t); }
    if (hand.seen) {
      const p = euroX.filter(hand.screen.x, lastDt);
      const q = euroY.filter(hand.screen.y, lastDt);
      t.push(now, p, q);
    }
    const at = t.at(now);
    if (at) hand.screen = at;
  }
  for (const id of [...traj.keys()]) if (!live.has(id)) traj.delete(id);
  return hands;
}

// --- Phase 2: gestures ------------------------------------------------------

/**
 * Point with the thumb held still to stake a structure. The pointing pose
 * lifts the pen (a curled hand is not pressing), so staking never smears ink.
 */
function readGestures(hands, now) {
  holdProgress = 0;
  let holdLabel = '—';
  let any = false;

  for (const hand of hands) {
    if (!usableHand(hand.points)) continue;
    const pointing = hand.seen && isPointing(hand.points);
    const palmPt = project(palmCenter(hand.points));
    const tipPt = project(hand.points[LM.THUMB_TIP]);
    const angle = pointing ? thumbAngleDeg(palmPt, tipPt) : null;

    const r = holds.update(hand.id, angle, pointing, now);
    if (r.progress > holdProgress) {
      holdProgress = r.progress;
      holdLabel = r.sector ? r.sector.label : '—';
    }
    if (r.ready) {
      const kind = r.sector.id;
      const at = hand.screen || tipPt;
      field.stake(kind, at.x, at.y);
      toast(`定桩 · ${r.sector.label}`);
    }
    if (pointing) any = true;
  }
  if (!any) holds.clear();
  m.hold.textContent = holdProgress > 0 ? `${holdLabel} ${Math.round(holdProgress * 100)}%` : '—';
}

/**
 * Two-hand field. Only applied to pens that are actually down, so you can hold
 * both hands up and watch the field without drawing through it.
 */
function applyField(hands, dt) {
  const pens = hands
    .filter((h) => h.screen)
    .map((h) => ({
      screen: h.screen,
      down: h.seen && (field.states.get(h.id)?.press ?? 0) > 0.3,
    }));
  twoHand.update(pens, dt, window.innerWidth, window.innerHeight);

  if (!twoHand.engaged || twoHand.amount < 0.01) return hands;

  // Each pen is warped by the *other* pen, so both move instead of one chasing
  // a fixed anchor.
  return hands.map((h) => {
    if (!h.screen || !h.seen) return h;
    const pen = pens.find((p) => p.screen === h.screen && p.down);
    if (!pen) return h;
    const other = pens.find((p) => p !== pen);
    if (!other) return h;
    return { ...h, screen: twoHand.apply(h.screen, other.screen), warped: true };
  });
}

// --- skeleton preview -------------------------------------------------------

function drawPreview(hands) {
  const c = pvCtx;
  const w = pv.width;
  const h = pv.height;
  c.save();
  c.translate(w, 0);
  c.scale(-1, 1);
  c.drawImage(video, 0, 0, w, h);
  c.restore();
  c.fillStyle = 'rgba(5,7,11,0.42)';
  c.fillRect(0, 0, w, h);

  c.strokeStyle = 'rgba(111,211,255,0.75)';
  c.lineWidth = 1.4;
  for (const hand of hands) {
    if (!usableHand(hand.points)) continue;
    const p = hand.points.map((q) => ({ x: (1 - q.x) * w, y: q.y * h }));
    c.beginPath();
    for (const [a, b] of SKELETON) {
      if (!p[a] || !p[b]) continue;
      c.moveTo(p[a].x, p[a].y);
      c.lineTo(p[b].x, p[b].y);
    }
    c.stroke();
    c.fillStyle = hand.seen ? '#ffb454' : '#ff8080';
    for (let i = 0; i < p.length; i++) {
      c.beginPath();
      c.arc(p[i].x, p[i].y, i === LM.THUMB_TIP ? 3.4 : i === LM.INDEX_TIP ? 3 : 1.5, 0, Math.PI * 2);
      c.fill();
    }
    // Dial: the eight sectors the thumb can point into.
    const palm = p[LM.WRIST];
    const thumb = p[LM.THUMB_TIP];
    c.strokeStyle = 'rgba(255,255,255,0.28)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(palm.x, palm.y);
    c.lineTo(thumb.x, thumb.y);
    c.stroke();
  }

  const any = hands.some((x) => x.seen);
  pvState.textContent = any ? `${hands.length} 只` : '未检测到手';
  pvState.style.color = any ? '' : '#ff8080';

  // The preview is the panel the user is already watching, so the whole
  // detection state goes here rather than only in the corner HUD.
  let reason;
  if (tracker.lastError) reason = `失败×${tracker.failStreak}: ${tracker.lastError.slice(0, 70)}`;
  else if (tracker.skipped === 'tiny-frame') reason = '尺寸无效';
  else if (tracker.skipped === 'no-video') reason = '摄像头未就绪';
  else if (tracker.rawLandmarks > 0) reason = '已检出手';
  else reason = '模型未检出手';
  pvDiag.className = any ? 'diag' : 'diag bad';
  // The exact message, and where it came from. A count cannot be acted on.
  const frameErr = lastFrameError
    ? `帧错误 ${frameErrorCount}: ${lastFrameError.slice(0, 110)}\n${String(frameErrorAt || '').slice(0, 110)}`
    : '';
  pvDiag.innerHTML =
    `${tracker.videoSize} · ${Math.round(tracker.fps())}/s · ${tracker.delegate ?? '—'}<br />` +
    `模型返回 <b>${tracker.rawLandmarks ?? 0}</b> 手 · 推理 <b>${fmt(tracker.inferenceMs, 0)}</b>ms<br />` +
    `<b>${escapeHtml(reason)}</b>` +
    (frameErr ? `<br /><b>${escapeHtml(frameErr)}</b>` : '');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function toggleFullscreen() {
  fullscreen = !fullscreen;
  for (const el of document.querySelectorAll('#hud, #keys, #toolbar, #preview')) {
    el.style.opacity = fullscreen ? '0' : '';
    el.style.pointerEvents = fullscreen ? 'none' : '';
  }
  if (fullscreen) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const nibKeys = { 1: 'silk', 2: 'flying', 3: 'splash', 4: 'rubbing' };
  if (nibKeys[k]) { setNib(nibKeys[k]); e.preventDefault(); return; }
  if (k === 'p') setPreview(!showPreview);
  else if (k === 'c') { field.clear(); toast('已清空'); }
  else if (k === 's') { save(); e.preventDefault(); }
  else if (k === 'f') toggleFullscreen();
  else if (k === 'v') setField(twoHand.cycle());
  else if (k === 'g') switchBackend();
  else if (k === 'h') {
    showChrome = !showChrome;
    for (const el of document.querySelectorAll('#hud, #keys, #toolbar')) el.style.display = showChrome ? '' : 'none';
  }
});

/**
 * Flip the inference backend live.
 *
 * A GPU delegate can report a healthy frame time while returning no hands at
 * all. Switching backends with one key is the fastest way to tell "the camera
 * feed has no detectable hand in it" apart from "this GPU path is broken".
 */
let switching = false;
async function switchBackend() {
  if (switching || !tracker.fileset) return;
  switching = true;
  const target = tracker.delegate === 'GPU' ? 'CPU' : 'GPU';
  toast(`切换到 ${target}…`);
  try {
    await tracker.setDelegate(target);
    if (target === 'GPU') tracker.warmUp();
    toast(`后端 ${target}`);
  } catch (err) {
    toast(`切换失败：${String(err?.message || err).slice(0, 40)}`);
  } finally {
    switching = false;
  }
}

function save() {
  const out = field.flatten();
  downloadCanvas(out, `gestura-${timestamp()}.png`);
  toast('已导出 PNG');
}

for (const b of document.querySelectorAll('#toolbar [data-nib]')) {
  b.addEventListener('click', () => setNib(b.dataset.nib));
}
for (const b of document.querySelectorAll('#toolbar [data-field]')) {
  b.addEventListener('click', () => setField(b.dataset.field));
}
document.getElementById('btn-preview').addEventListener('click', () => setPreview(!showPreview));
document.getElementById('btn-copydiag').addEventListener('click', async () => {
  const t = tracker;
  const lines = [
    `摄像头 ${t.videoSize}  检测 ${Math.round(t.fps())}/s  后端 ${t.delegate}`,
    `模型返回手数 ${t.rawLandmarks}  推理 ${t.inferenceMs.toFixed(1)}ms  skipped=${t.skipped}`,
    `识别到手 ${tracker.hands.length}  失败连续 ${t.failStreak}  跟踪错误 ${t.lastError || '无'}`,
    `帧错误 ${frameErrorCount} 次：${lastFrameError || '无'}`,
    `位置 ${frameErrorAt || '无'}`,
    `画布 ${field.w}x${field.h} dpr=${field.dpr}  状态 ${JSON.stringify(field.stats)}`,
    `dpr=${window.devicePixelRatio} 视口 ${window.innerWidth}x${window.innerHeight}`,
    `UA ${navigator.userAgent}`,
  ];
  const text = lines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('诊断已复制');
  } catch {
    // clipboard API needs a secure context / permission; fall back to a
    // selectable textarea so the text can still be copied by hand.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('诊断已复制'); }
    catch { toast('复制失败,请手动截图'); }
    ta.remove();
  }
});
document.getElementById('btn-clear').addEventListener('click', () => { field.clear(); toast('已清空'); });
document.getElementById('btn-save').addEventListener('click', save);
document.getElementById('gate-start').addEventListener('click', start);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { field.reset(); holds.clear(); }
});

// Debug handle. Every problem so far has come from having no way to inspect the
// live detection path from outside — this is what the browser console and the
// perf probes use, and it costs nothing at runtime.
window.gestura = { field, tracker, twoHand, holds, get stats() { return field.stats; } };

window.addEventListener('beforeunload', () => tracker.dispose());