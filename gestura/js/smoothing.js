// Signal conditioning for pen input.
//
// Two separate problems live here, and conflating them is what makes hand
// drawing feel bad in both directions at once:
//
//   1. JITTER — MediaPipe's landmarks wobble by a few pixels even on a still
//      hand, so a raw trace is visibly noisy.
//   2. LAG — smoothing fixes jitter by adding delay, and delay is felt far more
//      than noise when the hand is actually moving.
//
// A fixed-rate exponential smoother trades one for the other at a constant
// setting: aggressive enough to kill jitter while still is laggy when moving,
// and light enough to feel responsive while still is noisy at rest. The One Euro
// filter resolves this by adapting its cutoff to the observed speed — heavy
// smoothing when slow, light smoothing when fast.

/** First-order low-pass coefficient for a given cutoff and timestep. */
function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/**
 * One Euro filter (Casiez, Roussel & Vogel, CHI 2012).
 *
 *   minCutoff — lower is smoother when still; too low and slow strokes lag
 *   beta      — how much speed lowers the cutoff; higher tracks fast motion
 *               more aggressively at the cost of noise
 *   dCutoff   — cutoff for the speed estimate itself
 */
export class OneEuro {
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;
    this.dx = 0;
  }

  reset() {
    this.x = null;
    this.dx = 0;
  }

  /** @param value in input units, @param dt seconds (clamped by the caller) */
  filter(value, dt) {
    if (!Number.isFinite(value)) return this.x ?? 0;
    if (this.x === null || !(dt > 0)) {
      this.x = value;
      this.dx = 0;
      return value;
    }
    const dxRaw = (value - this.x) / dt;
    const aD = alpha(this.dCutoff, dt);
    this.dx = aD * dxRaw + (1 - aD) * this.dx;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const a = alpha(cutoff, dt);
    this.x = a * value + (1 - a) * this.x;
    return this.x;
  }

  get value() {
    return this.x ?? 0;
  }
}

/** One Euro filter over a 2D point. */
export class OneEuro2D {
  constructor(opts) {
    this.fx = new OneEuro(opts);
    this.fy = new OneEuro(opts);
  }

  reset() {
    this.fx.reset();
    this.fy.reset();
  }

  filter(p, dt) {
    return { x: this.fx.filter(p.x, dt), y: this.fy.filter(p.y, dt) };
  }
}

/**
 * Render-rate sampling of a sparsely sampled trajectory.
 *
 * Detection only runs when the camera delivers a new frame — typically 30/s —
 * while the page renders far more often. Using the raw detection point
 * therefore makes the pen step N times a second no matter how high the render
 * rate is, which reads as stutter even at 150 fps.
 *
 * This resamples between the two most recent detections and extrapolates a
 * little past the newest one, capped so a paused detector cannot fling the pen
 * off screen.
 */
export class Trajectory {
  constructor({ maxLead = 0.045, maxLag = 0.10 } = {}) {
    this.maxLead = maxLead;   // seconds of extrapolation past the newest sample
    this.maxLag = maxLag;     // seconds to still interpolate behind the newest
    this.a = null;            // { t, x, y }
    this.b = null;
  }

  reset() {
    this.a = null;
    this.b = null;
  }

  /** @param t milliseconds, matching the render clock */
  push(t, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const s = { t, x, y };
    // An out-of-order sample must be dropped, not merged: replacing the newest
    // point with an older one rewinds the timeline and the pen visibly jumps
    // backwards for one frame.
    if (this.b && t <= this.b.t) return;
    this.a = this.b;
    this.b = s;
  }

  /** Position at render time `t`, or null when there is nothing to draw yet. */
  at(t) {
    if (!this.b) return null;
    if (!this.a) return { x: this.b.x, y: this.b.y };
    const span = this.b.t - this.a.t;
    if (span <= 0) return { x: this.b.x, y: this.b.y };

    if (t <= this.b.t) {
      const back = (this.b.t - t) / 1000;
      if (back > this.maxLag) return { x: this.b.x, y: this.b.y };
      const u = (t - this.a.t) / span;
      return { x: this.a.x + (this.b.x - this.a.x) * u, y: this.a.y + (this.b.y - this.a.y) * u };
    }
    const lead = (t - this.b.t) / 1000;
    if (lead > this.maxLead) return { x: this.b.x, y: this.b.y };
    // Extrapolate along the last known direction; capped so a stalled detector
    // cannot send the pen flying.
    const u = 1 + lead * 1000 / span;
    return { x: this.b.x + (this.b.x - this.a.x) * (u - 1), y: this.b.y + (this.b.y - this.a.y) * (u - 1) };
  }

  /** Seconds between the two most recent samples — i.e. the detection period. */
  get period() {
    if (!this.a || !this.b) return 0;
    return (this.b.t - this.a.t) / 1000;
  }
}