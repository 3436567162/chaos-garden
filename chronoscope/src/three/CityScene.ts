// Scene, camera, lights, ground, post-processing. Owns the render loop; never auto-rotates.

import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import type { History } from '../history'
import { BlockField } from './BlockField'
import { CELL, type Layout } from './layout'
import {
  FOG_COLOR,
  GRID_MAJOR,
  GRID_MINOR,
  GROUND_COLOR,
  HORIZON_GLOW,
  LOT_COLOR,
  SKY_HORIZON,
  SKY_ZENITH
} from './palette'

const FOV = 38
const PITCH = (38 * Math.PI) / 180
const AZIMUTH = (-28 * Math.PI) / 180

/** Pointer travel, in CSS pixels, above which a press counts as an orbit drag. */
const CLICK_SLOP = 5

/** Cursor travel, in CSS pixels, below which a hover is not worth re-emitting. */
const HOVER_SLOP = 8

/** A block the pointer is over. `slot` indexes the layout and the mesh. */
export interface Pick {
  slot: number
  clientX: number
  clientY: number
}

function backdropTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 512
  const g = c.getContext('2d')!
  const lin = g.createLinearGradient(0, 0, 0, c.height)
  lin.addColorStop(0, SKY_ZENITH)
  lin.addColorStop(0.55, SKY_HORIZON)
  lin.addColorStop(0.82, '#3b2a55')
  lin.addColorStop(1, '#1a1530')
  g.fillStyle = lin
  g.fillRect(0, 0, c.width, c.height)
  // Low warm haze, as if the city sits under a sunset.
  const haze = g.createLinearGradient(0, c.height * 0.55, 0, c.height)
  haze.addColorStop(0, 'rgba(0,0,0,0)')
  haze.addColorStop(0.5, HORIZON_GLOW + '22')
  haze.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = haze
  g.fillRect(0, 0, c.width, c.height)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

/** Radial alpha: solid centre, transparent rim, so the ground has no hard edge. */
function radialTexture(inner: string, outer: string): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const g = c.getContext('2d')!
  const r = g.createRadialGradient(256, 256, 0, 256, 256, 256)
  r.addColorStop(0, inner)
  r.addColorStop(0.55, outer)
  r.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = r
  g.fillRect(0, 0, 512, 512)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

/** Grid lines whose brightness fades with distance from the centre. */
function fadingGrid(radius: number, step: number): LineSegments {
  const pos: number[] = []
  const col: number[] = []
  const major = new Color(GRID_MAJOR)
  const minor = new Color(GRID_MINOR)
  const n = Math.ceil(radius / step)
  const push = (x: number, z: number, c: Color) => {
    const f = Math.max(0, 1 - Math.hypot(x, z) / radius) ** 1.6
    pos.push(x, 0, z)
    col.push(c.r * f, c.g * f, c.b * f)
  }
  for (let i = -n; i <= n; i++) {
    const c = i % 5 === 0 ? major : minor
    const v = i * step
    // Split each line into segments so the radial fade is smooth along it.
    for (let j = -n; j < n; j++) {
      push(v, j * step, c); push(v, (j + 1) * step, c)
      push(j * step, v, c); push((j + 1) * step, v, c)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new Float32BufferAttribute(col, 3))
  const mat = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false
  })
  return new LineSegments(geo, mat)
}

function lotOutline(halfW: number, halfD: number): LineSegments {
  const w = halfW, d = halfD
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute([
    -w, 0, -d, w, 0, -d, w, 0, -d, w, 0, d, w, 0, d, -w, 0, d, -w, 0, d, -w, 0, -d
  ], 3))
  const mat = new LineBasicMaterial({
    color: '#6f74c9',
    transparent: true,
    opacity: 0.55,
    blending: AdditiveBlending,
    depthWrite: false
  })
  return new LineSegments(geo, mat)
}

export class CityScene {
  readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 4000)
  private readonly controls: OrbitControls
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly blockMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.08
  })
  private readonly key: DirectionalLight
  private readonly ground: Mesh<CircleGeometry, MeshStandardMaterial>
  private readonly lot: Mesh<CircleGeometry, MeshStandardMaterial>
  private grid: LineSegments | null = null
  private outline: LineSegments | null = null
  private field: BlockField | null = null
  private readonly resizeObserver: ResizeObserver
  private raf = 0
  private lastNow = 0
  private readonly ticks = new Set<(dt: number) => void>()

  private readonly raycaster = new Raycaster()
  private readonly pointerNdc = new Vector2()
  private pointerClient = { x: 0, y: 0 }
  private pointerInside = false
  private pointerMoved = false
  private pressOrigin: { x: number; y: number } | null = null
  private lastEmit = { slot: -1, x: -1, y: -1 }
  private readonly hoverCbs = new Set<(pick: Pick | null) => void>()
  private readonly clickCbs = new Set<(pick: Pick) => void>()
  /** Kept so dispose can detach them. */
  private readonly detachPointer: Array<() => void> = []

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = NeutralToneMapping
    this.renderer.toneMappingExposure = 1.1
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap
    container.appendChild(this.renderer.domElement)

    this.scene.background = backdropTexture()
    this.scene.fog = new Fog(FOG_COLOR, 60, 200)

    this.scene.add(new HemisphereLight('#9fb4ff', '#2a1d3a', 1.1))
    this.key = new DirectionalLight('#ffe2c4', 2.6)
    this.key.castShadow = true
    this.key.shadow.mapSize.set(2048, 2048)
    this.key.shadow.bias = -0.0004
    this.key.shadow.normalBias = 0.02
    this.key.shadow.radius = 3
    this.scene.add(this.key, this.key.target)
    const rim = new DirectionalLight('#7f8cff', 1.2)
    rim.position.set(0.8, 0.5, -1)
    this.scene.add(rim)

    this.ground = new Mesh(
      new CircleGeometry(1, 96),
      new MeshStandardMaterial({
        map: radialTexture(GROUND_COLOR, GROUND_COLOR + 'cc'),
        transparent: true,
        depthWrite: false,
        roughness: 1,
        metalness: 0
      })
    )
    this.ground.rotation.x = -Math.PI / 2
    this.ground.position.y = -0.03
    this.ground.receiveShadow = true
    this.scene.add(this.ground)

    // Brighter pool of light under the occupied area.
    this.lot = new Mesh(
      new CircleGeometry(1, 96),
      new MeshStandardMaterial({
        map: radialTexture(LOT_COLOR, LOT_COLOR + '66'),
        transparent: true,
        depthWrite: false,
        roughness: 0.9,
        metalness: 0
      })
    )
    this.lot.rotation.x = -Math.PI / 2
    this.lot.position.y = -0.02
    this.lot.receiveShadow = true
    this.scene.add(this.lot)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = Math.PI / 2 - 0.08
    this.controls.minDistance = 4
    this.controls.autoRotate = false

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.55, 0.6, 0.72)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.attachPointer()

    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop)
      const dt = Math.min(64, now - this.lastNow)
      this.lastNow = now
      for (const cb of this.ticks) cb(dt)
      this.pick()
      this.controls.update()
      this.composer.render()
    }
    this.lastNow = performance.now()
    this.raf = requestAnimationFrame(loop)
  }

  /**
   * Hover and click on the blocks. Picking is deferred to the render loop so a
   * burst of pointer events costs one raycast per frame, and a press only counts
   * as a click if the pointer barely moved — otherwise every orbit drag would
   * select a file.
   */
  private attachPointer(): void {
    const el = this.renderer.domElement
    const listen = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K | string,
      handler: (e: Event) => void
    ) => {
      target.addEventListener(type, handler as EventListener)
      this.detachPointer.push(() => target.removeEventListener(type, handler as EventListener))
    }

    const track = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      this.pointerClient = { x: e.clientX, y: e.clientY }
      this.pointerNdc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -(((e.clientY - rect.top) / rect.height) * 2 - 1)
      )
      this.pointerMoved = true
    }

    listen(el, 'pointermove', e => {
      this.pointerInside = true
      track(e as PointerEvent)
    })
    listen(el, 'pointerleave', () => {
      this.pointerInside = false
      this.lastEmit = { slot: -1, x: -1, y: -1 }
      this.emitHover(null)
    })
    listen(el, 'pointerdown', e => {
      this.pressOrigin = { x: (e as PointerEvent).clientX, y: (e as PointerEvent).clientY }
    })
    const endPress = (e: Event) => {
      const pe = e as PointerEvent
      const from = this.pressOrigin
      // Cleared first, so the bubbling pair (canvas then window) fires once.
      this.pressOrigin = null
      if (!from) return
      if (Math.hypot(pe.clientX - from.x, pe.clientY - from.y) > CLICK_SLOP) return
      track(pe)
      const pick = this.castPick()
      if (pick) for (const cb of this.clickCbs) cb(pick)
    }
    listen(el, 'pointerup', endPress)
    // A press released outside the canvas is not a click on a block.
    listen(window, 'pointerup', endPress)
  }

  private castPick(): Pick | null {
    if (!this.field || !this.pointerInside) return null
    this.raycaster.setFromCamera(this.pointerNdc, this.camera)
    const hit = this.raycaster.intersectObject(this.field.mesh, false)[0]
    const id = hit?.instanceId
    if (!hit || id === undefined) return null
    return { slot: id, clientX: this.pointerClient.x, clientY: this.pointerClient.y }
  }

  private emitHover(pick: Pick | null): void {
    const slot = pick ? pick.slot : -1
    const x = pick ? pick.clientX : -1
    const y = pick ? pick.clientY : -1
    // Same block and a cursor that barely moved: nothing downstream would change.
    const sameBlock = slot === this.lastEmit.slot
    const stillCursor = Math.hypot(x - this.lastEmit.x, y - this.lastEmit.y) < HOVER_SLOP
    if (sameBlock && stillCursor) return
    this.lastEmit = { slot, x, y }
    for (const cb of this.hoverCbs) cb(pick)
  }

  private pick(): void {
    if (!this.pointerMoved) return
    this.pointerMoved = false
    // Suppress the tooltip while orbiting so it does not chase the cursor.
    if (this.pressOrigin) {
      this.emitHover(null)
      return
    }
    this.emitHover(this.castPick())
  }

  /** Fires with the hovered block, or null when the pointer leaves. */
  onHover(cb: (pick: Pick | null) => void): () => void {
    this.hoverCbs.add(cb)
    return () => {
      this.hoverCbs.delete(cb)
    }
  }

  /** Fires on a click that was not an orbit drag. */
  onClick(cb: (pick: Pick) => void): () => void {
    this.clickCbs.add(cb)
    return () => {
      this.clickCbs.delete(cb)
    }
  }

  /**
   * Runs `cb(deltaMs)` once per rendered frame, before the scene is drawn.
   * Playback rides this loop instead of its own timer so the city and the
   * clock can never drift apart. Returns an unsubscribe function.
   */
  onTick(cb: (dt: number) => void): () => void {
    this.ticks.add(cb)
    return () => {
      this.ticks.delete(cb)
    }
  }

  setLayout(layout: Layout | null): void {
    if (this.field) {
      this.scene.remove(this.field.mesh)
      this.field.dispose()
      this.field = null
    }
    // No repository loaded yet: keep the ground, drop the city.
    if (!layout) {
      for (const old of [this.grid, this.outline]) {
        if (!old) continue
        this.scene.remove(old)
        old.geometry.dispose()
        ;(old.material as LineBasicMaterial).dispose()
      }
      this.grid = null
      this.outline = null
      return
    }
    this.field = new BlockField(layout, this.blockMaterial)
    this.scene.add(this.field.mesh)

    const margin = CELL * 1.5
    const halfW = layout.halfWidth + margin
    const halfD = layout.halfDepth + margin
    const radius = Math.hypot(halfW, halfD)

    this.lot.scale.setScalar(radius * 1.25)
    this.ground.scale.setScalar(radius * 4)

    for (const old of [this.grid, this.outline]) {
      if (!old) continue
      this.scene.remove(old)
      old.geometry.dispose()
      ;(old.material as LineBasicMaterial).dispose()
    }
    this.grid = fadingGrid(radius * 3, CELL * 2)
    this.grid.position.y = -0.01
    this.outline = lotOutline(halfW, halfD)
    this.outline.position.y = -0.005
    this.scene.add(this.grid, this.outline)

    // Shadow frustum hugs the city so the 2k map stays crisp.
    const s = this.key.shadow.camera
    s.left = s.bottom = -radius * 1.2
    s.right = s.top = radius * 1.2
    s.near = 1
    s.far = radius * 6
    s.updateProjectionMatrix()
    this.key.position.set(-0.55, 1, 0.6).normalize().multiplyScalar(radius * 3)
    this.key.target.position.set(0, 0, 0)

    this.frame(radius)
  }

  /** Renders the exact fractional position between two sample rows. */
showAt(history: History, lo: number, hi: number, fraction: number, staggered: boolean): void {
    this.field?.showAt(history, lo, hi, fraction, staggered)
  }

  private frame(radius: number): void {
    const dist = (radius + 4) / Math.sin((FOV * Math.PI) / 360) * 0.92
    this.camera.position.set(
      dist * Math.cos(PITCH) * Math.sin(AZIMUTH),
      dist * Math.sin(PITCH),
      dist * Math.cos(PITCH) * Math.cos(AZIMUTH)
    )
    this.controls.target.set(0, 1.5, 0)
    this.controls.maxDistance = dist * 3
    this.camera.far = dist * 10
    this.camera.updateProjectionMatrix()
    this.controls.update()
    const fog = this.scene.fog as Fog
    fog.near = dist * 0.9
    fog.far = dist * 3
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, false)
    this.composer.setPixelRatio(this.renderer.getPixelRatio())
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    for (const off of this.detachPointer) off()
    this.detachPointer.length = 0
    this.controls.dispose()
    this.field?.dispose()
    for (const l of [this.grid, this.outline]) {
      if (!l) continue
      l.geometry.dispose()
      ;(l.material as LineBasicMaterial).dispose()
    }
    for (const m of [this.ground, this.lot]) {
      m.geometry.dispose()
      m.material.map?.dispose()
      m.material.dispose()
    }
    ;(this.scene.background as CanvasTexture).dispose()
    this.blockMaterial.dispose()
    this.bloom.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
