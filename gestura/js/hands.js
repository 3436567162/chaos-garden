import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// Landmark geometry and pose rules live in pose.js so they can be tested in
// Node without MediaPipe; this module is only the capture and inference layer.
//
// Both an import and a re-export are needed, and the difference matters:
// `export { X } from './pose.js'` publishes X to importers but does NOT bind X
// in this module's own scope. Using LM here while only re-exporting it threw
// "LM is not defined" — but only inside #acquire, i.e. only on the frames where
// a hand was actually detected, which is why it looked like a hand-tracking
// freeze rather than a plain module error.
import { LM, openness, indexExtension } from './pose.js';
export {
  LM, SKELETON, openness, isPointing, palmCenter, curledFingers, usableHand,
  indexExtension, isWriting, DOWN_RATIO, UP_RATIO,
} from './pose.js';

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Consecutive detection failures before giving up on the GPU delegate.
const FAIL_THRESHOLD = 12;

export class HandTracker {
  constructor({ maxHands = 2 } = {}) {
    this.maxHands = maxHands;
    this.landmarker = null;
    this.video = null;
    this.stream = null;
    this.lastVideoTime = -1;
    this.hands = [];          // stable, id-matched across frames
    this.lostFrames = 0;
    this.inferenceMs = 0;
    this.detections = 0;
    this.delegate = null;
    this.gpuError = null;
    this.warmUpMs = 0;
    this.warmed = false;
    this.sizedOk = true;
    this.sizeNote = null;
    this.detecting = false;
    this.skipped = null;
    this.rawLandmarks = 0;
    this.lastResultKeys = 'none';
    this.failStreak = 0;
    this.lastError = null;
    this.pendingFallback = false;
  }

  /**
   * Rebuild the landmarker on the other delegate, live.
   *
   * The GPU delegate can fail in ways that are invisible: it still reports a
   * plausible frame time while returning an empty result set. Being able to
   * flip to CPU with one keypress is both a diagnostic and a real fallback.
   */
  async setDelegate(which) {
    const target = which === 'CPU' ? 'CPU' : 'GPU';
    if (!this.fileset) throw new Error('init() must run first');
    if (this.delegate === target) return this.delegate;
    const wasDetecting = this.detecting;
    this.landmarker?.close?.();
    this.landmarker = await HandLandmarker.createFromOptions(this.fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: target },
      runningMode: 'VIDEO',
      numHands: this.maxHands,
      minHandDetectionConfidence: this.confidence,
      minHandPresenceConfidence: this.confidence,
      minTrackingConfidence: this.confidence,
    });
    this.delegate = target;
    // Discard stale state: landmark ids from the old backend mean nothing here.
    this.hands = [];
    this.lastVideoTime = -1;
    this.detecting = false;
    this.inferenceMs = 0;
    // The counter must reset with the backend, otherwise the very next failure
    // on the fresh landmarker trips the threshold again immediately.
    this.failStreak = 0;
    this.skipped = null;
    void wasDetecting;
    return target;
  }

  /** Camera frames actually decoded per second — proves the stream is live. */
  fps() {
    const now = performance.now();
    if (this.fpsMark === undefined) {
      this.fpsMark = now;
      this.fpsCount = 0;
      return 0;
    }
    this.fpsCount = (this.fpsCount || 0) + 1;
    const dt = (now - this.fpsMark) / 1000;
    if (dt < 0.5) return this.fpsLast || 0;
    this.fpsLast = this.fpsCount / dt;
    this.fpsMark = now;
    this.fpsCount = 0;
    return this.fpsLast;
  }

  /** Live camera geometry, for the HUD. */
  get videoSize() {
    return this.video ? `${this.video.videoWidth}x${this.video.videoHeight}` : '—';
  }

  /**
   * Load the model, preferring the GPU delegate.
   *
   * Measured on an integrated GPU (Radeon 860M, 1280x720 stream):
   *   GPU delegate — 4.5 ms/frame steady, but the FIRST call costs ~3.2 s of
   *                   WebGL shader compilation on the main thread
   *   CPU delegate — 27.6 ms/frame steady (over a 60fps budget), but only
   *                   ~114 ms to warm up
   *
   * So the GPU path is the right choice and must be warmed up while the user is
   * still looking at the loading screen, or the first frame freezes the page
   * for seconds. If the GPU path cannot be created at all, fall back to CPU
   * rather than leaving the app dead.
   */
  async init() {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    this.fileset = fileset;
    this.confidence = 0.3;
    const build = (delegate) => HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: 'VIDEO',
      numHands: this.maxHands,
      minHandDetectionConfidence: this.confidence,
      minHandPresenceConfidence: this.confidence,
      minTrackingConfidence: this.confidence,
    });

    try {
      this.landmarker = await build('GPU');
      this.delegate = 'GPU';
    } catch (err) {
      this.gpuError = String(err?.message || err);
      this.landmarker = await build('CPU');
      this.delegate = 'CPU';
    }
    return this;
  }

  /**
   * Record why detection did not run this frame.
   * Zeroes the timing so the HUD cannot show a stale number as if it were live.
   */
  #skip(reason) {
    this.skipped = reason;
    this.detecting = false;
    this.inferenceMs = 0;
    return this.hands;
  }

  /**
   * Handle a detection failure without breaking the frame.
   *
   * The GPU delegate in particular can start throwing on every call after
   * working once — a lost WebGL context looks exactly like this from the app's
   * side. After a short streak the tracker rebuilds itself on the CPU delegate,
   * which is slower but keeps the app usable instead of dead.
   */
  #fail(err) {
    const msg = String(err?.message || err);
    const duplicateTimestamp = /timestamp/i.test(msg);
    this.failStreak = (this.failStreak || 0) + 1;
    this.lastError = msg;
    this.detecting = false;
    this.skipped = duplicateTimestamp ? 'duplicate-timestamp' : 'detect-failed';

    if (!duplicateTimestamp && this.failStreak === FAIL_THRESHOLD && this.delegate === 'GPU') {
      this.pendingFallback = true;
    }
    return this.hands;
  }

  /** Called from the frame loop so the rebuild never happens mid-frame. */
  async applyFallback() {
    if (!this.pendingFallback) return false;
    this.pendingFallback = false;
    try {
      await this.setDelegate('CPU');
      this.lastError = 'GPU 推理连续失败，已自动回退 CPU';
      return true;
    } catch (err) {
      this.lastError = `回退 CPU 失败：${String(err?.message || err).slice(0, 60)}`;
      return false;
    }
  }

  /**
   * Run one detection to pay the shader-compilation cost up front.
   *
   * Safe to call before the camera is live: it returns false when the video has
   * no usable frame yet, so the caller can retry. The first successful call is
   * the expensive one (~3.8 s of shader compilation on the GPU delegate).
   */
  warmUp() {
    const v = this.video;
    if (!v || !this.landmarker || v.readyState < 2) return false;
    if (v.videoWidth < 16) return false;
    this.lastVideoTime = v.currentTime;
    const t0 = performance.now();
    this.landmarker.detectForVideo(v, performance.now());
    this.warmUpMs = performance.now() - t0;
    this.warmed = true;
    return true;
  }

  /**
   * Wait for the camera to report a usable frame size.
   *
   * Some drivers report 1x1 or 2x2 placeholders for the first few frames, and
   * running detection on those is both useless and unrepresentative of the real
   * cost. But the wait must be bounded: a camera held by another app can keep
   * reporting a placeholder indefinitely, and an unbounded wait leaves the
   * loading screen up forever with no error to show.
   */
  #awaitUsableSize(videoEl, timeoutMs = 4000) {
    const ok = () => videoEl.videoWidth >= 16 && videoEl.videoHeight >= 16;
    if (ok()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        videoEl.removeEventListener('loadeddata', onChange);
        videoEl.removeEventListener('resize', onChange);
        videoEl.removeEventListener('canplay', onChange);
        clearTimeout(timer);
        resolve(value);
      };
      const onChange = () => { if (ok()) finish(true); };
      const timer = setTimeout(() => finish(false), timeoutMs);
      for (const ev of ['loadeddata', 'resize', 'canplay']) videoEl.addEventListener(ev, onChange);
    });
  }

  async openCamera(videoEl, { width = 1280, height = 720 } = {}) {
    this.video = videoEl;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: width }, height: { ideal: height }, facingMode: 'user' },
      audio: false,
    });
    videoEl.srcObject = this.stream;
    await videoEl.play();
    this.sizedOk = await this.#awaitUsableSize(videoEl);
    if (!this.sizedOk) {
      // Proceed anyway: update() skips detection until the size is usable, so
      // the app still starts and simply reports no hands until it clears.
      this.sizeNote = `摄像头未上报有效分辨率（${videoEl.videoWidth}x${videoEl.videoHeight}），将等待画面就绪`;
    }
    return { width: videoEl.videoWidth, height: videoEl.videoHeight, sized: this.sizedOk };
  }

  /**
   * Run inference if the camera produced a new frame.
   * Returns the current `hands` array (stable objects, reused between frames).
   */
  update(nowMs, project) {
    const v = this.video;
    if (!v || !this.landmarker || v.readyState < 2) return this.#skip('no-video');
    // A placeholder-sized frame carries no information. Skipping it is right,
    // but the reason must be visible: an earlier version silently returned here
    // while leaving the previous inference time on screen, so the HUD reported a
    // plausible frame time for detection that was not running at all.
    if (v.videoWidth < 16 || v.videoHeight < 16) return this.#skip('tiny-frame');
    if (v.currentTime === this.lastVideoTime) {
      // Camera did not produce a new frame — normal, and not a stall.
      this.skipped = 'newer-frame-pending';
      return this.hands;
    }
    this.lastVideoTime = v.currentTime;
    this.skipped = null;
    this.detecting = true;
    this.fpsCount = (this.fpsCount || 0) + 1;

    const t0 = performance.now();
    let res;
    try {
      res = this.landmarker.detectForVideo(v, nowMs);
      this.failStreak = 0;
      this.lastError = null;
    } catch (err) {
      // A detection failure must never propagate. This used to rethrow anything
      // that was not a timestamp error, which meant one bad call could break
      // every subsequent frame — the page froze with the reason visible only in
      // the console. Detection is best-effort: degrade, record, and keep drawing.
      this.inferenceMs = performance.now() - t0;
      return this.#fail(err);
    }
    this.inferenceMs = performance.now() - t0;
    this.detections++;

    const seen = new Set();
    const raw = res.landmarks || [];
    // Raw model output, before any of our own filtering: if this is 0 the model
    // genuinely found nothing, which is a different problem from our tracking
    // dropping a hand it did find.
    this.rawLandmarks = raw.length;
    this.lastResultKeys = raw.length ? Object.keys(res).join(',') : 'none';
    for (let i = 0; i < raw.length; i++) {
      const lm = raw[i];
      if (!lm || lm.length < 21) continue;
      const category = res.handedness?.[i]?.[0];
      const label = category?.categoryName || 'Hand';
      const score = category?.score ?? 0;
      const hand = this.#acquire(label, i, lm);
      hand.points = lm;
      hand.confidence = score;
      hand.screen = project(lm[LM.INDEX_TIP]);
      hand.openness = openness(lm);
      // Pen-down signal, derived here so it travels with the detection result and
      // no consumer needs to know about landmark layout.
      hand.indexRatio = indexExtension(lm);
      hand.seen = true;
      seen.add(hand.id);
    }

    for (const h of this.hands) if (!seen.has(h.id)) { h.seen = false; h.gap = (h.gap || 0) + 1; }
    // Drop hands that have been gone long enough that resuming would draw a
    // long straight line across the canvas from wherever the hand used to be.
    this.hands = this.hands.filter((h) => h.gap === undefined || h.gap < 12);
    for (const h of this.hands) if (h.gap) h.gap++;
    this.lostFrames = this.hands.length === 0 ? this.lostFrames + 1 : 0;

    return this.hands;
  }

  #acquire(label, slot, lm) {
    // Identity: prefer the same handedness at a nearby wrist position; this
    // survives the brief swaps MediaPipe does when hands cross.
    const wx = lm[LM.WRIST].x;
    let best = null;
    let bestD = 0.34;
    for (const h of this.hands) {
      if (h.label !== label) continue;
      const d = Math.abs(h.wristX - wx);
      if (d < bestD) { best = h; bestD = d; }
    }
    if (best) { best.gap = 0; best.wristX = wx; return best; }
    const hand = { id: `${label}-${this.detections}-${slot}`, label, wristX: wx, gap: 0, seen: true };
    this.hands.push(hand);
    return hand;
  }

  dispose() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.landmarker?.close?.();
    this.landmarker = null;
    this.hands = [];
  }
}
