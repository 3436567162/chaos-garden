import { clamp } from './util.js';

// Thumb is the pointing digit, so eight staked structures means eight angular
// sectors rather than eight finger counts (a hand cannot show eight).
// Sectors are laid out like a compass rose starting at screen-up, going
// clockwise, which is also the order the README lists them in.
// `id` is the structure-builder key, so a committed sector maps straight onto
// a generator with no lookup table between them.
export const SECTORS = [
  { id: 'lattice', label: '晶格',   from: -22.5,  to: 22.5 },
  { id: 'fractal', label: '分形',   from: 22.5,   to: 67.5 },
  { id: 'radial',  label: '放射',   from: 67.5,   to: 112.5 },
  { id: 'helix',   label: '双螺旋', from: 112.5,  to: 157.5 },
  { id: 'rings',   label: '环',     from: 157.5,  to: 202.5 },
  { id: 'starburst', label: '星芒', from: 202.5,  to: 247.5 },
  { id: 'mesh',    label: '网格',   from: 247.5,   to: 292.5 },
  { id: 'ripples', label: '波纹',   from: 292.5,   to: 337.5 },
];

// The pointing hand must be held still long enough to be deliberate. Short
// enough that it does not feel like a modal dialog.
export const HOLD_MS = 700;
export const HOLD_SLOP_DEG = 26;

/** Angle of the thumb direction, degrees clockwise from screen-up. */
export function thumbAngleDeg(palm, tip) {
  const dx = tip.x - palm.x;
  const dy = tip.y - palm.y;
  if (Math.abs(dx) + Math.abs(dy) < 1e-4) return null;
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

export function sectorOf(angleDeg) {
  if (angleDeg === null) return null;
  const a = ((angleDeg % 360) + 360) % 360;
  for (const s of SECTORS) {
    const to = s.to > s.from ? s.to : s.to + 360; // last sector wraps through 0
    if (a >= s.from && a < to) return s;
  }
  return SECTORS[0];
}

/** Smallest absolute angular difference, 0..180. */
export function angleDelta(a, b) {
  if (a === null || b === null) return Infinity;
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Tracks how long each hand has been held in a pointing pose.
 *
 * A gesture is "same sector held still", not "currently in a sector" — the
 * slop window matters because a hand pointing at 40 degrees is still pointing
 * at 分形 (22.5–67.5) and must not restart its hold every time tracking noise
 * nudges it across the 22.5 boundary.
 */
export class HoldTracker {
  constructor({ holdMs = HOLD_MS, slopDeg = HOLD_SLOP_DEG } = {}) {
    this.holdMs = holdMs;
    this.slopDeg = slopDeg;
    this.state = new Map();
  }

  reset(id) {
    this.state.delete(id);
  }

  clear() {
    this.state.clear();
  }

  /**
   * @returns {{ sector, angle, progress, ready }}
   *   ready flips true for exactly one call, so a single hold commits once.
   */
  update(id, angleDeg, pointing, nowMs) {
    if (!pointing || angleDeg === null) {
      this.state.delete(id);
      return { sector: null, angle: null, progress: 0, ready: false };
    }
    const sector = sectorOf(angleDeg);
    let s = this.state.get(id);
    if (!s || angleDelta(angleDeg, s.angle) > this.slopDeg) {
      s = { angle: angleDeg, sector: sector.id, since: nowMs, fired: false };
      this.state.set(id, s);
    }
    const progress = clamp((nowMs - s.since) / this.holdMs, 0, 1);
    let ready = false;
    if (progress >= 1 && !s.fired) {
      s.fired = true;
      ready = true;
    }
    return { sector, angle: angleDeg, progress, ready };
  }
}