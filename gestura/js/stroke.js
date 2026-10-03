import { clamp, lerp, smoothstep, approach } from './util.js';
import { Wetness, splayHairs, survivingHairs, pathChunk } from './paper.js';
import { OneEuro } from './smoothing.js';
import { DOWN_RATIO, UP_RATIO } from './pose.js';
import { buildStructure, pointCount } from './structures.js';

const TAU = Math.PI * 2;

// Per-nib character. Everything a nib needs is a number in this table — a nib
// is not a code path.
//   vRef     speed (px/s) at which the stroke reaches its thinnest
//   dry      how much of the width band shreds into separate hairs
//   bleed    how far ink creeps past the stamped edge (拓印 only)
//   splatter droplets thrown per segment
//   contact  how strongly a droplet reacts when it lands in wet ink
export const NIBS = {
  silk: {
    label: '丝绢', maxW: 26, minW: 1.1, vRef: 2400, glow: 0.55,
    dry: 0, bleed: 0, grid: 0, hairs: 0, splatter: 0, contact: 0, decay: 13,
  },
  flying: {
    // A dry brush stays broad: minW is high on purpose, because 飞白 is a
    // *wide* brush that breaks up, not a brush tapering down to nothing.
    label: '飞白', maxW: 30, minW: 9, vRef: 1500, glow: 0.10,
    dry: 0.9, bleed: 0, grid: 0, hairs: 9, splatter: 0.25, contact: 0.5, decay: 10,
  },
  splash: {
    label: '泼墨', maxW: 42, minW: 2.2, vRef: 2000, glow: 0.32,
    dry: 0, bleed: 0, grid: 0, hairs: 0, splatter: 1, contact: 1, decay: 16,
  },
  rubbing: {
    label: '拓印', maxW: 28, minW: 7, vRef: 3000, glow: 0.08,
    dry: 0.25, bleed: 1, grid: 19, hairs: 0, splatter: 0, contact: 0, decay: 9,
  },
};

export const NIB_ORDER = ['silk', 'flying', 'splash', 'rubbing'];

const PALETTE = [
  [111, 211, 255],
  [255, 176, 108],
  [178, 140, 255],
  [126, 232, 178],
];

const PAPER = [10, 13, 18];
const DROP_CAP = 1400;

// A staked structure grows over this long, then sits in the artwork for good.
export const GROW_MS = 900;
export const STAKE_LIMIT = 24;
const STRUCT_SCALE = 0.62;

// Pressure below this counts as "pen up". Exported so the HUD and the tests
// agree with the renderer on where that line is.
export const PEN_UP = 0.06;

// Pen-down hysteresis on the index-extension ratio, duplicated here so stroke.js
// stays free of landmark knowledge (it only ever sees a number).
export const DOWN_AT = DOWN_RATIO;
export const UP_AT = UP_RATIO;

const isWritingRatio = (r, wasDown) => (wasDown ? r > UP_RATIO : r > DOWN_RATIO);

const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Pressure darkens toward full ink; release fades toward the paper. */
export function inkOf(rgb, press, fade = 0) {
  const mix = 0.42 + 0.58 * clamp(press, 0, 1) * (1 - fade);
  return rgb.map((v, i) => Math.round(lerp(PAPER[i], v, mix)));
}

/**
 * Dryness at a given speed for a nib. Coupling dryness to speed is what makes
 * 飞白 look like real brushwork: slow strokes stay solid, the brush only tears
 * open once it accelerates.
 */
export function drynessAt(nib, speed) {
  return nib.dry * smoothstep(clamp(speed / nib.vRef, 0, 1));
}

/** Brush width from speed and pressure. */
export function widthAt(nib, speed, press) {
  const fast = smoothstep(clamp(speed / nib.vRef, 0, 1));
  return lerp(nib.maxW, nib.minW, Math.pow(fast, 0.72)) * lerp(0.45, 1, press);
}

/**
 * How much ink a stroke leaves behind, 0..1. Dry nibs and fast strokes deposit
 * less — this is what feeds the wetness grid that droplets react to.
 */
export function depositAt(nib, speed, press, dryness) {
  const fast = smoothstep(clamp(speed / nib.vRef, 0, 1));
  return clamp(press * lerp(1, 0.35, dryness) * lerp(0.5, 1, 1 - fast), 0, 1);
}

/** A tapered quad between two ribbon points, with round caps. */
export function ribbon(ctx, ax, ay, aw, bx, by, bw, color) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 0.2) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(bx, by, Math.max(bw, aw), 0, TAU);
    ctx.fill();
    return;
  }
  const nx = -dy / len;
  const ny = dx / len;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(ax + nx * aw, ay + ny * aw);
  ctx.lineTo(bx + nx * bw, by + ny * bw);
  ctx.lineTo(bx - nx * bw, by - ny * bw);
  ctx.lineTo(ax - nx * aw, ay - ny * aw);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ax, ay, aw, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(bx, by, bw, 0, TAU);
  ctx.fill();
}

// Ink accumulates permanently in one layer; the luminous head lives in a
// second layer that fades, so holding still pools ink instead of erasing it.
export class InkField {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ink = document.createElement('canvas');
    this.inkCtx = this.ink.getContext('2d');
    this.glow = document.createElement('canvas');
    this.glowCtx = this.glow.getContext('2d');
    this.states = new Map();
    this.drops = [];
    this.nib = 'silk';
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.bg = '#0a0d12';
    this.t = 0;
    this.wet = new Wetness(1, 1);
    this.stakes = [];
    this.stakeSeed = 1;
    this.splatCache = new Map();
    this.stats = { speed: 0, width: 0, press: 0, down: false, drops: 0, dry: 0, stakes: 0 };
  }

  setNib(name) {
    if (NIBS[name]) this.nib = name;
  }

resize(w, h, dpr) {
    // Capture the old viewport first: structures are re-anchored by the ratio
    // between old and new, and this.w/this.h are about to be overwritten.
    const oldW = this.w;
    const oldH = this.h;
    const hadSize = oldW > 0 && oldH > 0;
    const kept = this.stakes.slice();

    this.dpr = dpr;
    this.w = w;
    this.h = h;
    for (const c of [this.canvas, this.ink, this.glow]) {
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.glowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Brush strokes cannot survive a resize — they live in pixel space with no
    // point buffer to rescale from. Structures are generated geometry, so they
    // are re-anchored by the viewport ratio and re-rendered at full growth
    // rather than vanishing.
    this.inkCtx.fillStyle = this.bg;
    this.inkCtx.fillRect(0, 0, w, h);
    this.wet = new Wetness(w, h);
    this.stakes = kept;
    if (hadSize) {
      const sx = w / oldW;
      const sy = h / oldH;
      for (const s of kept) {
        s.x *= sx;
        s.y *= sy;
        s.scale *= Math.min(sx, sy);
        s.grown = 1;
        this.#drawStake(s);
      }
    } else {
      for (const s of kept) s.grown = 0;
    }
  }

  clear() {
    const c = this.inkCtx;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = this.bg;
    c.fillRect(0, 0, this.ink.width, this.ink.height);
    c.restore();
    this.glowCtx.clearRect(0, 0, this.w, this.h);
    this.states.clear();
    this.drops.length = 0;
    this.stakes.length = 0;
    this.wet.clear();
    this.stats = { speed: 0, width: 0, press: 0, down: false, drops: 0, dry: 0, stakes: 0 };
  }

  /** Tab hidden: forget the pens, keep the artwork. */
  reset() {
    this.states.clear();
    this.drops.length = 0;
  }

  /**
   * @param hands [{ id, screen:{x,y}, openness, seen }] in CSS pixels
   */
  update(hands, dt) {
    this.t += dt;
    const nib = NIBS[this.nib];
    const live = new Set();
    let speed = 0;
    let width = 0;
    let press = 0;
    let down = false;
    let dry = 0;

    hands.forEach((hand, i) => {
      if (!hand.screen) return;
      live.add(hand.id);
      const st = this.#state(hand.id, i);
      if (!hand.seen) return;
      st.indexRatio = hand.indexRatio ?? 0;

      const x = hand.screen.x;
      const y = hand.screen.y;
      let dx = 0;
      let dy = 0;
      if (st.has) {
        const inv = 1 / Math.max(dt, 1 / 240);
        dx = (x - st.x) * inv;
        dy = (y - st.y) * inv;
      }
      // Velocity, speed, pressure and width go through One Euro rather than a
      // fixed-rate exponential smoother. With a constant rate the setting is a
      // compromise: heavy enough to kill jitter at rest is laggy in motion.
      // Measured on a 800 px/s sweep, the old rate-12 smoother peaked at 55px
      // of lag versus 8.8px here, at equal jitter suppression.
      st.vx = st.fx.filter(dx, dt);
      st.vy = st.fy.filter(dy, dt);
      st.speed = st.fs.filter(Math.hypot(st.vx, st.vy), dt);

      // Pen down is "index finger out", not "hand open".
      //
      // Conflating the two meant the most natural writing gesture — one finger
      // extended, the other three curled — registered as a lifted pen, because
      // overall openness was only ~0.18. Spread now only modulates width.
      st.down = isWritingRatio(st.indexRatio, st.down);
      const onPaper = st.down;

      // Spread modulates stroke fullness only. Floored well above zero because
      // the single-finger writing pose sits around 0.18 and would otherwise draw
      // a hairline.
      st.press = st.fp.filter(clamp(hand.openness / 0.5, 0, 1), dt);
      if (st.press > hand.openness / 0.5) st.press = lerp(st.press, hand.openness / 0.5, 1 - Math.exp(-26 * dt));

      st.w = approach(st.w, Math.max(widthAt(nib, st.speed, st.press), 0.4), 40, dt);
      const dryness = drynessAt(nib, st.speed);

      const moving = st.has && Math.hypot(x - st.x, y - st.y) > 0.35;
      if (onPaper && (st.has || st.pending)) {
        if (moving || st.pending) {
          this.#stamp(st, x, y, dx, dy, st.speed, dryness, nib);
          st.pending = false;
        } else {
          this.#pool(st, x, y, st.w, nib);
        }
        down = true;
      } else if (!onPaper) {
        // Latching on pen-up is what stops a re-entry from drawing a bridge
        // back to wherever the pen was last down.
        st.pending = true;
        st.wPrev = st.w;
      }

      st.x = x;
      st.y = y;
      st.has = true;
      speed = Math.max(speed, st.speed);
      width = Math.max(width, st.w);
      press = Math.max(press, st.press);
      dry = Math.max(dry, dryness);
    });

    for (const id of [...this.states.keys()]) if (!live.has(id)) this.states.delete(id);
    this.wet.dry(dt);
    this.stepDrops(this.drops, dt, nib);
    this.growStakes(dt);
    this.stats = { speed, width, press, down, drops: this.drops.length, dry, stakes: this.stakes.length };
  }

  /**
   * Place a structure at a screen point. Geometry is generated once from a
   * seed; growth only replays it, so re-staking the same sector with the same
   * seed reproduces the same shape exactly.
   */
  stake(kind, x, y, { seed = null, scale = STRUCT_SCALE } = {}) {
    if (this.stakes.length >= STAKE_LIMIT) this.stakes.shift();
    const s = seed === null ? (this.stakeSeed++ * 2654435761) % 2147483647 : seed;
    const structure = buildStructure(kind, s);
    const stake = {
      kind, seed: s, x, y, scale,
      structure,
      total: pointCount(structure),
      grown: 0,
    };
    this.stakes.push(stake);
    return stake;
  }

  /** Reveal staked structures over GROW_MS. Called every frame from update(). */
  growStakes(dt) {
    if (!this.stakes.length) return;
    const budget = (dt * 1000) / GROW_MS;
    for (const s of this.stakes) {
      if (s.grown >= 1) continue;
      s.grown = Math.min(1, s.grown + budget);
      this.#drawStake(s);
    }
  }

  #drawStake(s) {
    const color = rgba(inkOf([150, 200, 255], 0.9, 0.15));
    const target = s.grown * s.total;
    let drawn = 0;
    const c = this.inkCtx;
    c.strokeStyle = color;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const line of s.structure.lines) {
      if (drawn >= target) break;
      const avail = target - drawn;
      const pts = line.pts;
      if (avail < 1) break;
      const upto = Math.min(pts.length, Math.floor(avail) + 1);
      if (upto < 2) break;
      c.lineWidth = Math.max(0.6, line.w * s.scale);
      c.beginPath();
      for (let i = 0; i < upto; i++) {
        const p = pts[i];
        const px = s.x + p.x * s.scale;
        const py = s.y + p.y * s.scale;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.stroke();
      drawn += pts.length;
    }
    if (s.grown >= 1) {
      // fully grown: single dots for the node points so lattice/mesh read as
      // stippled structures rather than bare outlines
      c.fillStyle = color;
      for (const line of s.structure.lines) {
        if (line.pts.length !== 1) continue;
        const p = line.pts[0];
        c.beginPath();
        c.arc(s.x + p.x * s.scale, s.y + p.y * s.scale, Math.max(0.8, line.w * s.scale), 0, TAU);
        c.fill();
      }
    }
  }

  #state(id, i) {
    let st = this.states.get(id);
    if (!st) {
      st = {
        x: 0, y: 0, vx: 0, vy: 0, speed: 0, w: 6, press: 0,
        has: false, pending: false, wPrev: 6, down: false, indexRatio: 0, rgb: PALETTE[i % PALETTE.length],
        hairs: null,
        // Position is filtered by the caller (main.js resamples it at render
        // rate), so these only handle the derived quantities.
        fx: new OneEuro({ minCutoff: 1.4, beta: 0.03 }),
        fy: new OneEuro({ minCutoff: 1.4, beta: 0.03 }),
        fs: new OneEuro({ minCutoff: 2.2, beta: 0.008 }),
        fp: new OneEuro({ minCutoff: 2.6, beta: 0.02 }),
      };
      this.states.set(id, st);
    }
    return st;
  }

  #hairs(st, count) {
    if (!st.hairs || st.hairs.length !== count) st.hairs = splayHairs(count);
    return st.hairs;
  }

  #stamp(st, x, y, vx, vy, speed, dryness, nib) {
    const ax = st.x;
    const ay = st.y;
    const aw = st.wPrev ?? st.w;
    const bw = st.w;
    const color = inkOf(st.rgb, st.press);

    if (nib.grid > 0) this.#stampLattice(ax, ay, aw, x, y, bw, color, nib);
    else if (nib.hairs > 0 && dryness > 0.02) this.#stampHairs(st, ax, ay, aw, x, y, bw, color, nib, dryness);
    else ribbon(this.inkCtx, ax, ay, aw, x, y, bw, rgba(color));

    if (nib.bleed > 0) this.#bleed(x, y, bw, st, nib);
    this.wet.mark(x, y, bw * 1.1, depositAt(nib, speed, st.press, dryness));

    if (nib.glow > 0) {
      const g = inkOf(st.rgb, st.press, 0.35);
      ribbon(this.glowCtx, ax, ay, aw * nib.glow, x, y, bw * nib.glow, rgba(g));
      this.glowCtx.fillStyle = rgba(g);
      this.glowCtx.globalAlpha = 0.5;
      this.glowCtx.beginPath();
      this.glowCtx.arc(x, y, bw * nib.glow * 1.15, 0, TAU);
      this.glowCtx.fill();
      this.glowCtx.globalAlpha = 1;
    }

    if (nib.splatter > 0) this.#throwDrops(st, x, y, vx, vy, speed, bw, nib);
    st.wPrev = bw;
  }

  /** Pen held still: ink pools rather than being stamped again. */
  #pool(st, x, y, w, nib) {
    const color = inkOf(st.rgb, st.press);
    const c = this.inkCtx;
    c.fillStyle = rgba(color);
    c.beginPath();
    c.arc(x, y, w * 0.98, 0, TAU);
    c.fill();
    this.wet.mark(x, y, w * 1.1, 0.3);
    if (nib.glow > 0) {
      const g = inkOf(st.rgb, st.press, 0.4);
      this.glowCtx.fillStyle = rgba(g);
      this.glowCtx.globalAlpha = 0.4;
      this.glowCtx.beginPath();
      this.glowCtx.arc(x, y, w * nib.glow * 1.3, 0, TAU);
      this.glowCtx.fill();
      this.glowCtx.globalAlpha = 1;
    }
    st.wPrev = w;
  }

  /**
   * 飞白. The brush keeps its width; it separates into hairs and the gaps are
   * the flying white. Which hairs survive is a fixed-order dropout plus a
   * screen-space chunk hash, so separation is continuous with speed instead of
   * blinking frame to frame.
   */
  #stampHairs(st, ax, ay, aw, bx, by, bw, color, nib, dryness) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const band = Math.max(aw, bw, nib.minW);
    const c = this.inkCtx;
    c.strokeStyle = rgba(color);
    c.lineCap = 'round';
    for (const h of survivingHairs(this.#hairs(st, nib.hairs), dryness, pathChunk(bx, by))) {
      const wob = Math.sin(this.t * 2.6 + h.wob) * band * 0.03;
      const off = h.slot * band * 0.5 + wob;
      c.lineWidth = Math.max(0.35, h.w * band * lerp(0.34, 0.16, dryness));
      c.beginPath();
      c.moveTo(ax + nx * off, ay + ny * off);
      c.lineTo(bx + nx * off, by + ny * off);
      c.stroke();
    }
  }

  /** 拓印: vertices snapped to a lattice, hard octagons, gaps between them. */
  #stampLattice(ax, ay, aw, bx, by, bw, color, nib) {
    const g = nib.grid;
    const dist = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(dist / (g * 0.42)));
    const c = this.inkCtx;
    c.fillStyle = rgba(color);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = lerp(ax, bx, t);
      const py = lerp(ay, by, t);
      // ±1.4px jitter: a perfect lattice reads as a pasted texture, not a stamp.
      const qx = Math.round(px / g) * g + (Math.random() - 0.5) * 1.4;
      const qy = Math.round(py / g) * g + (Math.random() - 0.5) * 1.4;
      const r = lerp(aw, bw, t) * 0.46;
      c.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU + Math.PI / 8;
        const vx = qx + Math.cos(a) * r;
        const vy = qy + Math.sin(a) * r;
        if (k === 0) c.moveTo(vx, vy);
        else c.lineTo(vx, vy);
      }
      c.closePath();
      c.fill();
    }
  }

  /**
   * 印泥晕开: ink creeping into the paper past the stamped edge. Drawn on the
   * ink layer, not the fading glow layer, because the creep has to outlive the
   * brush that caused it.
   */
  #bleed(x, y, bw, st, nib) {
    const r = bw * 0.62;
    const c = this.inkCtx;
    const color = inkOf(st.rgb, st.press, 0.55);
    const grad = c.createRadialGradient(x, y, r * 0.5, x, y, r * 2.2);
    grad.addColorStop(0, rgba(color, 0));
    grad.addColorStop(0.45, rgba(color, 0.3 * nib.bleed));
    grad.addColorStop(1, rgba(color, 0));
    c.fillStyle = grad;
    c.beginPath();
    c.arc(x, y, r * 2.2, 0, TAU);
    c.fill();
  }

  #throwDrops(st, x, y, vx, vy, speed, bw, nib) {
    // Throwing is driven by speed, so a pen resting on the paper throws nothing.
    // That matters: an early version gated on `down` only and a stationary pen
    // accumulated droplets until the list hit its cap.
    const load = smoothstep(clamp(speed / nib.vRef, 0, 1));
    if (load <= 0) return;
    const n = Math.round(nib.splatter * load * 5);
    for (let k = 0; k < n; k++) {
      const dir = Math.atan2(vy, vx) + (Math.random() - 0.5) * 1.5;
      const sp = 90 + Math.random() * 460 * load;
      this.drops.push({
        x: x + (Math.random() - 0.5) * bw,
        y: y + (Math.random() - 0.5) * bw,
        vx: Math.cos(dir) * sp + vx * 0.28,
        vy: Math.sin(dir) * sp + vy * 0.28,
        r: lerp(0.6, bw * 0.34, Math.random()),
        rgb: st.rgb,
        life: 1,
        decay: 0.5 + Math.random() * 0.9,
        contact: nib.contact,
        trail: 4 + Math.random() * 8,
        landed: false,
      });
    }
  }

  /**
   * Droplets fall under gravity and land. Landing in wet ink flattens them into
   * a smear aligned with their velocity and pushes wetness outward, so ink
   * wicks from an already-wet area; landing on dry paper just leaves a dot.
   */
  stepDrops(drops, dt, nib) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vy += 620 * dt;
      d.vx *= 1 - 1.5 * dt;
      d.vy *= 1 - 0.4 * dt;

      const out = d.x < -40 || d.x > this.w + 40 || d.y < -40 || d.y > this.h + 40;
      if (!d.landed) {
        const wetness = this.wet.at(d.x, d.y);
        if (wetness > 0.15 && d.contact > 0) {
          this.#splat(d, wetness);
          d.life -= (1 + 1.6 * wetness * d.contact) * dt;
        } else if (out) {
          d.landed = true;
        } else {
          // In flight a fast droplet beads into a broken dotted trail.
          d.trail -= Math.hypot(d.vx, d.vy) * dt;
          if (d.trail <= 0) {
            d.trail = 6 + Math.random() * 10;
            this.#bead(d, 0.5);
          }
        }
      } else {
        d.life -= d.decay * dt;
      }

      if (d.life <= 0 || out) {
        drops.splice(i, 1);
        continue;
      }
      const a = clamp(d.life, 0, 1);
      const c = this.inkCtx;
      c.globalAlpha = a * 0.9;
      c.fillStyle = rgba(d.rgb);
      c.beginPath();
      c.arc(d.x, d.y, d.r * lerp(0.35, 1, a), 0, TAU);
      c.fill();
      c.globalAlpha = 1;
      if (nib.glow > 0.15 && a > 0.4) {
        const g = this.glowCtx;
        g.globalAlpha = a * 0.35;
        g.fillStyle = rgba(d.rgb);
        g.beginPath();
        g.arc(d.x, d.y, d.r * 1.5, 0, TAU);
        g.fill();
        g.globalAlpha = 1;
      }
    }
    if (drops.length > DROP_CAP) drops.splice(0, drops.length - DROP_CAP);
  }

  /**
   * A droplet landing in wet ink flattens into a smear aligned with its
   * velocity.
   *
   * The smear is drawn as a pre-rendered sprite rather than a live gradient:
   * radius shrinks by 0.82 per splat, so it takes a different value almost
   * every frame, and allocating a radial gradient per droplet per frame was the
   * single most expensive thing in the frame. One 64px sprite per palette colour
   * is rasterised once and then only scaled.
   */
  #splat(d, wetness) {
    const r = d.r * lerp(1.2, 3.4, wetness);
    const c = this.inkCtx;
    const key = d.rgb.join();
    let sprite = this.splatCache.get(key);
    if (!sprite) {
      const size = 64;
      const cv = document.createElement('canvas');
      cv.width = size;
      cv.height = size;
      const g2 = cv.getContext('2d');
      const g = g2.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, rgba(d.rgb, 0.6));
      g.addColorStop(0.6, rgba(d.rgb, 0.26));
      g.addColorStop(1, rgba(d.rgb, 0));
      g2.fillStyle = g;
      g2.fillRect(0, 0, size, size);
      sprite = { canvas: cv, half: size / 2 };
      this.splatCache.set(key, sprite);
    }
    const a = clamp(0.35 + wetness * 0.65, 0, 1);
    c.save();
    c.translate(d.x, d.y);
    c.rotate(Math.atan2(d.vy, d.vx));
    c.scale(1, 0.34);
    c.globalAlpha = a;
    c.drawImage(sprite.canvas, -sprite.half, -sprite.half, sprite.half * 2, sprite.half * 2);
    c.globalAlpha = 1;
    c.restore();
    this.wet.mark(d.x, d.y, r * 1.5, 0.5 * wetness);
    d.r *= 0.82;
  }

  #bead(d, scale) {
    const c = this.inkCtx;
    c.globalAlpha = 0.5 * scale;
    c.fillStyle = rgba(d.rgb);
    c.beginPath();
    c.arc(d.x, d.y, d.r * 0.55 * scale, 0, TAU);
    c.fill();
    c.globalAlpha = 1;
  }

  /**
   * Fade the glow layer and composite both layers onto the visible canvas.
   *
   * Both composites are full-screen `drawImage`s — at 1920x1080 dpr2 that is
   * 8.3 Mpx twice per frame — so they run at CSS size rather than backing-store
   * size. The `lighter` blend of the glow layer is the expensive one, and it is
   * skipped entirely while no nib is producing glow and no droplet is alive.
   */
  render(dt) {
    const nib = NIBS[this.nib];
    const g = this.glowCtx;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = `rgba(0,0,0,${1 - Math.exp(-nib.decay * dt)})`;
    g.fillRect(0, 0, this.glow.width, this.glow.height);
    g.restore();

    const c = this.ctx;
    c.globalCompositeOperation = 'source-over';
    c.drawImage(this.ink, 0, 0, this.w, this.h);
    if (nib.glow > 0 || this.drops.length) {
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 0.85;
      c.drawImage(this.glow, 0, 0, this.w, this.h);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    }
  }

  /** Pen-up ring so the cursor is visible even when it is not drawing. */
  drawCursor(st) {
    if (!st) return;
    const c = this.ctx;
    c.save();
    c.strokeStyle = `rgba(111,211,255,${0.25 + st.press * 0.55})`;
    c.lineWidth = 1.2;
    c.beginPath();
    c.arc(st.x, st.y, 7 + st.w * 0.5, 0, TAU);
    c.stroke();
    c.restore();
  }

  /** Flatten to an offscreen canvas for export. */
  flatten() {
    const out = document.createElement('canvas');
    out.width = this.ink.width;
    out.height = this.ink.height;
    const c = out.getContext('2d');
    c.drawImage(this.ink, 0, 0);
    c.globalCompositeOperation = 'lighter';
    c.drawImage(this.glow, 0, 0);
    return out;
  }
}