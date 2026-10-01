// Snapshot → per-slot visual targets, and the tween between two target sets.
//
// Each slot holds STRIDE floats: [height, footprint, r, g, b] in linear RGB.
// height == 0 means "no file here at this moment".

import { Color } from 'three'
import type { Snapshot } from '../types'
import { CELL, type Layout } from './layout'
import { langColor } from './palette'

export const STRIDE = 5
export const TRANSITION_MS = 300

const HEIGHT_SCALE = 0.9
const MAX_HEIGHT = 10
const MIN_HEIGHT = 0.08
const FOOTPRINT_MIN = 0.42
const FOOTPRINT_SPAN = 0.4
const FOOTPRINT_REF = Math.log1p(20000)
// Vanishing blocks darken towards the ground while they shrink.
const FADE_OUT_COLOR = 0.15

export function heightFor(lines: number): number {
  if (lines <= 0) return MIN_HEIGHT
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.log1p(lines) * HEIGHT_SCALE))
}

export function footprintFor(lines: number): number {
  const t = Math.min(1, Math.log1p(Math.max(0, lines)) / FOOTPRINT_REF)
  return CELL * (FOOTPRINT_MIN + FOOTPRINT_SPAN * t)
}

const rgbCache = new Map<string, [number, number, number]>()
function rgbOf(lang: string): [number, number, number] {
  let rgb = rgbCache.get(lang)
  if (!rgb) {
    const c = new Color(langColor(lang))
    rgb = [c.r, c.g, c.b]
    rgbCache.set(lang, rgb)
  }
  return rgb
}

export function buildTargets(layout: Layout, snapshot: Snapshot, out: Float32Array): Float32Array {
  out.fill(0)
  for (const f of snapshot.files) {
    const slot = layout.slotOf.get(f.path)
    if (slot === undefined) continue
    const o = slot * STRIDE
    const rgb = rgbOf(f.isBinary ? 'Binary' : f.lang)
    out[o] = heightFor(f.lines)
    out[o + 1] = footprintFor(f.lines)
    out[o + 2] = rgb[0]
    out[o + 3] = rgb[1]
    out[o + 4] = rgb[2]
  }
  return out
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

export class Morph {
  readonly current: Float32Array
  private readonly from: Float32Array
  private readonly to: Float32Array
  private start = 0
  private duration = TRANSITION_MS
  private active = false

  constructor(slots: number) {
    this.current = new Float32Array(slots * STRIDE)
    this.from = new Float32Array(slots * STRIDE)
    this.to = new Float32Array(slots * STRIDE)
  }

  /**
   * Starts a transition from whatever is on screen right now, so retargeting
   * mid-flight (fast scrubbing) never jumps.
   */
  retarget(target: Float32Array, now: number, duration = TRANSITION_MS): void {
    const { from, to, current } = this
    from.set(current)
    to.set(target)
    for (let o = 0; o < to.length; o += STRIDE) {
      if (to[o] === 0) {
        to[o + 2] = from[o + 2] * FADE_OUT_COLOR
        to[o + 3] = from[o + 3] * FADE_OUT_COLOR
        to[o + 4] = from[o + 4] * FADE_OUT_COLOR
      } else if (from[o] === 0) {
        // Appearing blocks rise out of dark ground rather than from black-on-nothing.
        from[o + 2] = to[o + 2] * FADE_OUT_COLOR
        from[o + 3] = to[o + 3] * FADE_OUT_COLOR
        from[o + 4] = to[o + 4] * FADE_OUT_COLOR
      }
    }
    this.start = now
    this.duration = Math.max(1, duration)
    this.active = true
  }

  /** Advances the tween; returns true when `current` changed this frame. */
  step(now: number): boolean {
    if (!this.active) return false
    const t = Math.min(1, Math.max(0, (now - this.start) / this.duration))
    const e = easeOutCubic(t)
    const { from, to, current } = this
    for (let i = 0; i < current.length; i++) current[i] = from[i] + (to[i] - from[i]) * e
    if (t >= 1) this.active = false
    return true
  }
}
