import { clamp, lerp, approach } from './util.js';

// Two-hand field modes. The field only acts on a pen that is actually down, so
// you can hold both hands up to inspect the field without smearing ink.
export const FIELDS = [
  { id: 'off',    label: '无场' },
  { id: 'mirror', label: '镜像' },
  { id: 'attract', label: '吸引' },
  { id: 'repel',  label: '排斥' },
];

// Below this separation the two pens are effectively one point and the field
// would divide by ~0.
export const MIN_SEPARATION = 90;
export const REPEL_MAX = 260;
export const ATTRACT_MAX = 110;

export function fieldById(id) {
  return FIELDS.find((f) => f.id === id) || FIELDS[0];
}

/**
 * Warp one pen by the field established between two hands.
 *
 * `anchor` is the other pen's screen position. Returns the point to draw at —
 * identity for 'off' and for a pen that is up, so callers can apply it
 * unconditionally.
 */
export function warp(mode, point, anchor, w, h) {
  if (mode === 'off' || !anchor) return point;
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const dist = Math.hypot(dx, dy);
  if (dist < MIN_SEPARATION) return point;
  const ux = dx / dist;
  const uy = dy / dist;

  if (mode === 'mirror') {
    // Reflect through the canvas' vertical midline. Reflecting through the
    // *midpoint of the two hands* instead would collapse each pen onto the
    // other one's position — they would overwrite each other rather than
    // producing a symmetric figure.
    return { x: w - point.x, y: point.y };
  }
  if (mode === 'attract') {
    // Pull toward the midpoint along the separation vector. Close hands barely
    // interact and wide hands pull hard, which is what makes the field feel
    // elastic rather than linear. ATTRACT_MAX keeps the two pens from crossing
    // each other and turning the figure inside out.
    const pull = Math.min(dist * 0.5, ATTRACT_MAX * 2) * 0.5;
    return { x: point.x - ux * pull, y: point.y - uy * pull };
  }
  if (mode === 'repel') {
    // Push away from the other pen. Clamped inside the viewport so a hard
    // shove cannot fling ink off-screen where it can never be seen again.
    const push = Math.min(dist * 0.45, REPEL_MAX);
    const margin = 8;
    return {
      x: clamp(point.x + ux * push, margin, w - margin),
      y: point.y + uy * push,
    };
  }
  return point;
}

/**
 * Tracks which field is active. It engages only while two hands are both down
 * and far enough apart, and eases out when they are not — a field that snapped
 * on would smear ink the instant tracking dropped a frame.
 */
export class FieldState {
  constructor() {
    this.mode = 'off';
    this.amount = 0;
    this.engaged = false;
  }

  set(id) {
    this.mode = fieldById(id).id;
  }

  cycle() {
    const i = FIELDS.findIndex((f) => f.id === this.mode);
    this.mode = FIELDS[(i + 1) % FIELDS.length].id;
    return this.mode;
  }

  /**
   * @param pens [{ x, y, down }] — usually two, but one or zero is fine
   * @returns effective mode for this frame
   */
  update(pens, dt, w, h) {
    const live = pens.filter((p) => p && p.down);
    const spread = live.length >= 2
      ? Math.hypot(live[0].x - live[1].x, live[0].y - live[1].y)
      : 0;
    this.engaged = this.mode !== 'off' && live.length >= 2 && spread >= MIN_SEPARATION;
    const target = this.engaged ? 1 : 0;
    this.amount = approach(this.amount, target, this.engaged ? 7 : 11, dt);
    this.width = w;
    this.height = h;
    return this.engaged ? this.mode : 'off';
  }

  /** Apply the eased field to one pen. */
  apply(point, anchor) {
    if (this.amount < 0.01) return point;
    const a = point;
    const b = warp(this.mode, point, anchor, this.width, this.height);
    return { x: lerp(a.x, b.x, this.amount), y: lerp(a.y, b.y, this.amount) };
  }
}