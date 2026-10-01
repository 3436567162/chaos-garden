// Snapshot → per-slot visual targets, and blending between two target sets.
//
// Each slot holds STRIDE floats: [height, footprint, r, g, b] in linear RGB.
// height == 0 means "no file here at this moment".

import { Color } from 'three'
import type { Snapshot } from '../types'
import { CELL, type Layout } from './layout'
import { langColor } from './palette'

export const STRIDE = 5

const HEIGHT_SCALE = 0.9
const MAX_HEIGHT = 10
const MIN_HEIGHT = 0.08
const FOOTPRINT_MIN = 0.42
const FOOTPRINT_SPAN = 0.4
const FOOTPRINT_REF = Math.log1p(20000)

/**
 * Peak delay as a fraction of the segment. Blocks further from the centre start
 * later, so a commit reads as a ripple across the city rather than every tower
 * snapping in the same frame.
 */
const STAGGER_SPAN = 0.55

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

function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1024) / 1024
}

/**
 * Per-slot normalised delay in [0, STAGGER_SPAN). Mostly radial so the wave rolls
 * outward from the middle of the city, plus a per-path jitter so the wave front
 * is not a perfect ring.
 */
export function buildStagger(layout: Layout, out: Float32Array): Float32Array {
  const n = layout.paths.length
  const maxR = Math.max(1e-6, Math.hypot(layout.halfWidth, layout.halfDepth))
  for (let i = 0; i < n; i++) {
    const r = Math.min(1, Math.hypot(layout.x[i], layout.z[i]) / maxR)
    out[i] = STAGGER_SPAN * Math.min(1, 0.76 * r ** 0.65 + 0.24 * hash01(layout.paths[i]))
  }
  return out
}

/** C1 ease-out; zero slope at both ends. */
const smoothstep = (t: number) => t * t * (3 - 2 * t)

/**
 * Near-linear: the slope at t=0 equals the slope at t=1, so motion carries
 * across commit boundaries instead of stalling at every one.
 */
const FLOW_MIX = 0.32
const flow = (t: number) => t + (smoothstep(t) - t) * FLOW_MIX

export class Morph {
  readonly current: Float32Array
  private readonly stagger: Float32Array

  constructor(slots: number, stagger: Float32Array) {
    this.current = new Float32Array(slots * STRIDE)
    this.stagger = stagger
  }

  /**
   * Writes a fractional position between two target sets straight into
   * `current`. There is no internal tween: the caller owns the clock, so a
   * playhead can be parked at 0.37 while playback stays in motion, and neither
   * path dead-ends waiting for the other.
   *
   * `staggered` spreads the segment across the city for playback; when false the
   * fraction is applied exactly, which is what a parked playhead needs.
   */
  blend(a: Float32Array, b: Float32Array, f: number, staggered: boolean): void {
    const { current, stagger } = this
    const t0 = f < 0 ? 0 : f > 1 ? 1 : f
    for (let i = 0, s = 0; i < current.length; i += STRIDE, s++) {
      let e = t0
      if (staggered) {
        const d = stagger[s]
        e = flow(t0 <= d ? 0 : (t0 - d) / (1 - d))
      }
      for (let k = 0; k < STRIDE; k++) {
        const av = a[i + k]
        current[i + k] = av + (b[i + k] - av) * e
      }
    }
  }
}