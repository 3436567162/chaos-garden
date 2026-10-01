// Pulsing overlay on a subset of the city's blocks.
//
// A second InstancedMesh rather than recolouring the main one: the main field is
// rewritten every frame by the morph, so anything drawn into it would be erased
// on the next sample change. Keeping the suspects separate means the highlight
// survives scrubbing, and the suspect set is small enough that a second mesh
// costs nothing.

import {
  AdditiveBlending,
  BoxGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D
} from 'three'

const PULSE_HZ = 0.7

export class Highlight {
  mesh: InstancedMesh
  private readonly geometry = new BoxGeometry(1, 1, 1)
  private readonly material = new MeshBasicMaterial({
    color: 0xffb86b,
    transparent: true,
    opacity: 0.5,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false
  })
  private readonly dummy = new Object3D()
  private slots: number[] = []
  private phase = 0

  constructor() {
    this.mesh = Highlight.makeMesh(this.geometry, this.material, 1)
  }

  private static makeMesh(
    geometry: BoxGeometry,
    material: MeshBasicMaterial,
    count: number
  ): InstancedMesh {
    const mesh = new InstancedMesh(geometry, material, count)
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3), 3)
    mesh.frustumCulled = false
    mesh.renderOrder = 2
    mesh.visible = false
    return mesh
  }

  /** Replaces the highlighted set. An empty list hides the mesh. */
  set(slots: number[], x: Float32Array, z: Float32Array, heightFor: (slot: number) => number): void {
    this.slots = slots
    const n = Math.max(1, slots.length)
    // Allocated once per distinct size; InstancedMesh capacity is fixed at
    // construction, so a growing suspect set needs a new mesh.
    if (this.mesh.instanceMatrix.count !== n) {
      this.mesh.dispose()
      this.mesh = Highlight.makeMesh(this.geometry, this.material, n)
    }
    this.mesh.visible = slots.length > 0
    this.mesh.count = slots.length

    const colour = this.mesh.instanceColor!
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      // Slightly oversized so the glow reads as a shell around the block.
      const h = Math.max(0.2, heightFor(slot))
      this.dummy.position.set(x[slot] ?? 0, 0, z[slot] ?? 0)
      this.dummy.scale.set(0.62, h + 0.16, 0.62)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
      colour.setXYZ(i, 1, 0.72, 0.42)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    colour.needsUpdate = true
  }

  clear(): void {
    this.slots = []
    this.mesh.visible = false
    this.mesh.count = 0
  }

  get count(): number {
    return this.slots.length
  }

  /** Advances the pulse. Called from the render loop. */
  update(dtSeconds: number): void {
    if (!this.mesh.visible) return
    this.phase += dtSeconds * PULSE_HZ * Math.PI * 2
    const k = 0.32 + 0.34 * (0.5 + 0.5 * Math.sin(this.phase))
    this.material.opacity = k
  }

  dispose(): void {
    this.mesh.dispose()
    this.geometry.dispose()
    this.material.dispose()
  }
}