// One InstancedMesh for every file slot in the layout. Never one Mesh per file.

import {
  BoxGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material
} from 'three'
import type { Snapshot } from '../types'
import type { Layout } from './layout'
import { Morph, STRIDE, buildTargets } from './morph'

// Degenerate scales still go through the matrix; keep them non-zero so normals stay finite.
const EPS = 1e-4
const TOP_GLOW = 1.45
const SIDE_BASE = 0.42
const BOTTOM = 0.25

/**
 * Unit box standing on y = 0 with a baked vertical gradient in its vertex
 * colours: dark at the foot (cheap contact shading), bright lit roof.
 * The instance colour multiplies this in the shader.
 */
function towerGeometry(): BoxGeometry {
  const g = new BoxGeometry(1, 1, 1)
  g.translate(0, 0.5, 0)
  const pos = g.getAttribute('position')
  const normal = g.getAttribute('normal')
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const ny = normal.getY(i)
    const y = pos.getY(i)
    const k = ny > 0.5 ? TOP_GLOW : ny < -0.5 ? BOTTOM : SIDE_BASE + (1 - SIDE_BASE) * y
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = k
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return g
}

export class BlockField {
  readonly mesh: InstancedMesh
  readonly layout: Layout
  private readonly geometry: BoxGeometry
  private readonly morph: Morph
  private readonly targets: Float32Array

  constructor(layout: Layout, material: Material) {
    this.layout = layout
    const count = Math.max(1, layout.paths.length)
    this.geometry = towerGeometry()

    this.mesh = new InstancedMesh(this.geometry, material, count)
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3), 3)
    this.mesh.instanceColor.setUsage(DynamicDrawUsage)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    // Instances move every frame; the cached bounding sphere would be stale.
    this.mesh.frustumCulled = false

    this.morph = new Morph(count)
    this.targets = new Float32Array(count * STRIDE)
    this.write()
  }

  show(snapshot: Snapshot, now: number, duration?: number): void {
    buildTargets(this.layout, snapshot, this.targets)
    this.morph.retarget(this.targets, now, duration)
  }

  update(now: number): void {
    if (this.morph.step(now)) this.write()
  }

  private write(): void {
    const m = this.mesh.instanceMatrix.array as Float32Array
    const c = this.mesh.instanceColor!.array as Float32Array
    const cur = this.morph.current
    const { x, z } = this.layout
    const n = this.mesh.count
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE
      const h = cur[o] > EPS ? cur[o] : EPS
      const w = cur[o] > EPS ? cur[o + 1] : EPS
      // Column-major scale + translation, no rotation.
      const k = i * 16
      m[k] = w; m[k + 1] = 0; m[k + 2] = 0; m[k + 3] = 0
      m[k + 4] = 0; m[k + 5] = h; m[k + 6] = 0; m[k + 7] = 0
      m[k + 8] = 0; m[k + 9] = 0; m[k + 10] = w; m[k + 11] = 0
      m[k + 12] = x[i] ?? 0; m[k + 13] = 0; m[k + 14] = z[i] ?? 0; m[k + 15] = 1
      const j = i * 3
      c[j] = cur[o + 2]
      c[j + 1] = cur[o + 3]
      c[j + 2] = cur[o + 4]
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
  }

  dispose(): void {
    this.geometry.dispose()
    this.mesh.dispose()
  }
}
