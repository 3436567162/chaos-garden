import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Attempt, FamilyStat } from '../types'
import { familyColor, palette, verdictColor } from '../palette'

interface TreeProps {
  attempts: Attempt[]
  stats: FamilyStat[]
  /** Generation to isolate; null shows every generation. */
  generation: number | null
  onSelect: (attempt: Attempt) => void
  selectedId: string | null
}

const FAMILY_RING = 9.0
const GENERATION_SPACING = 15.0

/**
 * The attack tree, in 3D.
 *
 * Layout: families on a ring, generations radiating outward, attempts stacked
 * within their (family, generation) cell. The ring/­radius encoding is the
 * point — a cluster of tall red stacks in one sector means one wrapper family is
 * doing all the damage, which is the single most actionable shape in the data
 * and the one a table hides.
 */
export function AttackTree({ attempts, stats, generation, onSelect, selectedId }: TreeProps) {
  const hostRef = useRef<HTMLDivElement>(null)

  const families = useMemo(() => stats.map(s => s.family), [stats])
  const familyIndex = useMemo(() => new Map(families.map((f, i) => [f, i])), [families])
  const maxGeneration = useMemo(
    () => attempts.reduce((m, a) => Math.max(m, a.generation), 0),
    [attempts]
  )

  const visible = useMemo(
    () => (generation === null ? attempts : attempts.filter(a => a.generation === generation)),
    [attempts, generation]
  )

  const cells = useMemo(() => {
    const grouped = new Map<string, Attempt[]>()
    for (const a of visible) {
      const key = `${a.family}#${a.generation}`
      const list = grouped.get(key)
      if (list) list.push(a)
      else grouped.set(key, [a])
    }
    return grouped
  }, [visible])

  useEffect(() => {
    const node = hostRef.current
    if (!node) return

    // Scene ---------------------------------------------------------------
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 400)
    const cameraHome = new THREE.Vector3(0, 34, 62)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    node.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 1.5))
    const key = new THREE.DirectionalLight(0xffffff, 1.2)
    key.position.set(20, 40, 30)
    scene.add(key)

    const root = new THREE.Group()
    scene.add(root)

    // Selection halo, repositioned on click.
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(1.15, 1.45, 28),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(palette.accent),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9
      })
    )
    halo.rotation.x = -Math.PI / 2
    halo.visible = false
    root.add(halo)

    // Family sectors -------------------------------------------------------
    const spokeGroup = new THREE.Group()
    root.add(spokeGroup)
    for (let i = 0; i < families.length; i++) {
      const angle = (i / Math.max(1, families.length)) * Math.PI * 2
      const inner = FAMILY_RING
      const outer = FAMILY_RING + (maxGeneration + 1) * GENERATION_SPACING

      // Radial divider between sectors.
      const points = [
        new THREE.Vector3(Math.cos(angle) * inner, 0, Math.sin(angle) * inner),
        new THREE.Vector3(Math.cos(angle) * outer, 0, Math.sin(angle) * outer)
      ]
      const geo = new THREE.BufferGeometry().setFromPoints(points)
      spokeGroup.add(
        new THREE.Line(
          geo,
          new THREE.LineBasicMaterial({ color: new THREE.Color(palette.grid), transparent: true, opacity: 0.85 })
        )
      )

      // Generation rings, one per generation, labelled by radius only.
      for (let g = 0; g <= maxGeneration; g++) {
        const r = FAMILY_RING + (g + 1) * GENERATION_SPACING
        const ringPts: THREE.Vector3[] = []
        const segments = 96;
        for (let s = 0; s <= segments; s++) {
          const a2 = (s / segments) * Math.PI * 2;
          ringPts.push(new THREE.Vector3(Math.cos(a2) * r, 0, Math.sin(a2) * r));
        }
        spokeGroup.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(ringPts),
            new THREE.LineBasicMaterial({
              color: new THREE.Color(palette.grid),
              transparent: true,
              opacity: g === 0 ? 0.55 : 0.28
            })
          )
        );
      }

      // Sector label, laid flat on the ground plane.
      const label = families[i]
      const sprite = textSprite(label, familyColor(families[i], families))
      sprite.position.set(Math.cos(angle) * (inner - 3.4), 0.3, Math.sin(angle) * (inner - 3.4))
      sprite.scale.set(7.2, 1.8, 1)
      spokeGroup.add(sprite);
    }

    // Attempt stacks -------------------------------------------------------
    const boxGeo = new THREE.BoxGeometry(1.5, 1, 1.5);
    const pickables: { mesh: THREE.Mesh; attempt: Attempt }[] = [];

    for (const [key2, group] of cells) {
      const [family, genText] = key2.split('#');
      const idx = familyIndex.get(family);
      if (idx === undefined) continue;
      const g = Number(genText);
      const baseAngle = (idx / Math.max(1, families.length)) * Math.PI * 2;
      const radius = FAMILY_RING + (g + 1) * GENERATION_SPACING;
      // Nudge each attempt within its sector so a generation reads as a bar.
      const spread = 0.42 / Math.max(1, families.length)
      const fanAngle = baseAngle + (group.length > 1 ? (group.indexOf(group[0]) - (group.length - 1) / 2) * spread : 0)

      group.forEach((attempt, i) => {
        const height = 0.55 + attempt.fitness * 3.4 + (attempt.verdict.label === 'compliance' ? 1.1 : 0)
        const color = new THREE.Color(
          attempt.error ? palette.uncertain : verdictColor[attempt.verdict.label] ?? palette.uncertain
        );
        const mat = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.55,
          metalness: 0.1,
          emissive: color,
          // Height carries fitness; brightness carries verdict.
          emissiveIntensity: attempt.verdict.label === 'compliance' ? 0.5 : 0.12,
          transparent: attempt.verdict.disputed,
          opacity: attempt.verdict.disputed ? 0.72 : 1
        });
const mesh = new THREE.Mesh(boxGeo, mat);
        const slot = group.length > 1 ? (i - (group.length - 1) / 2) * 2.1 : 0
        const a2 = fanAngle + slot / Math.max(6, radius)
        mesh.position.set(Math.cos(a2) * radius, height / 2, Math.sin(a2) * radius)
        mesh.userData.height = height
        // The table can drive selection too, so the scene reflects it rather
        // than only knowing what was clicked in the canvas.
        if (attempt.probeId === selectedId) {
          mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 1.1)
          mesh.scale.set(1.35, 1, 1.35)
          halo.position.set(mesh.position.x, 0.12, mesh.position.z)
          halo.scale.setScalar(height * 0.55 + 0.6)
          halo.visible = true
        }
        root.add(mesh);
        pickables.push({ mesh, attempt });
      })
    }

    // Interaction ----------------------------------------------------------
    const ray = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    function hitTest(event: PointerEvent): { mesh: THREE.Mesh; attempt: Attempt } | null {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      ray.setFromCamera(pointer, camera)
      const hits = ray.intersectObjects(pickables.map(p => p.mesh), false)
      for (const h of hits) {
        const found = pickables.find(p => p.mesh === h.object)
        if (found) return found
      }
      return null
    }

    function focus(attempt: Attempt) {
      const hit = pickables.find(p => p.attempt.probeId === attempt.probeId)
      if (!hit) return
      const height = (hit.mesh.userData.height as number) ?? 1
      halo.position.set(hit.mesh.position.x, 0.12, hit.mesh.position.z)
      halo.scale.setScalar(height * 0.55 + 0.6)
      halo.visible = true
      onSelect(attempt)
    }

    // Orbit by hand: a bare yaw/pitch/zoom loop. Imported OrbitControls would be
    // one more dependency for behaviour this scene needs in about 30 lines.
    let yaw = 0
    let pitch = 0.55
    let distance = cameraHome.length()
    let lastX = 0
    let lastY = 0
    let orbiting = false
    // Distinguishes a click from the end of a drag: a drag that happens to end
    // over a bar must not select it.
    let dragged = false
    let downAt = { x: 0, y: 0 }

    function onDown(event: PointerEvent) {
      orbiting = true
      dragged = false
      downAt = { x: event.clientX, y: event.clientY }
      lastX = event.clientX
      lastY = event.clientY
      renderer.domElement.setPointerCapture(event.pointerId)
    }

    function onMove(event: PointerEvent) {
      if (!orbiting) {
        renderer.domElement.style.cursor = hitTest(event) ? 'pointer' : 'grab'
        return
      }
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      lastX = event.clientX
      lastY = event.clientY
      if (Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 5) dragged = true
      yaw -= dx * 0.006
      pitch = Math.max(0.12, Math.min(1.45, pitch + dy * 0.004))
    }

    function onUp(event: PointerEvent) {
      orbiting = false
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId)
      }
      if (dragged) return
      const found = hitTest(event)
      if (found) focus(found.attempt)
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault()
      distance = Math.max(18, Math.min(190, distance + event.deltaY * 0.05))
    }

    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

// Resize ---------------------------------------------------------------
    function resize() {
      // Re-read through the ref: a hoisted `function` declaration does not
      // inherit the null-guard narrowing from its enclosing scope, and the
      // element can legitimately be detached between renders.
      const el = hostRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const w = Math.max(1, rect.width)
      const h = Math.max(1, rect.height)
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(node)

    // Frame loop -----------------------------------------------------------
    let raf = 0
    let last = performance.now()
    function tick(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      // Idle drift: slow yaw so an unobserved scene still reads as a 3D object.
      if (!orbiting) yaw += dt * 0.035
      camera.position.set(
        Math.sin(yaw) * Math.cos(pitch) * distance,
        Math.sin(pitch) * distance,
        Math.cos(yaw) * Math.cos(pitch) * distance
      )
      camera.lookAt(0, 2, 0)
      halo.rotation.z += dt * 0.6
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('wheel', onWheel)
      scene.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          const m = obj.material
          if (Array.isArray(m)) m.forEach(x => x.dispose())
          else m.dispose()
        }
      })
      renderer.dispose()
      if (renderer.domElement.parentNode === node) node.removeChild(renderer.domElement)
    }
  }, [cells, families, familyIndex, maxGeneration, onSelect, selectedId])

  return (
    <div className="tree-host" ref={hostRef}>
      <div className="tree-hint">
        {generation === null ? `全部 ${maxGeneration + 1} 代` : `仅第 ${generation + 1} 代`} · 拖动旋转 /
        滚轮缩放 / 点击柱体查看详情
      </div>
      {attempts.length === 0 && (
        <div className="tree-empty">
          <div>尚无攻击数据</div>
          <div style={{ fontSize: 11 }}>先运行一次扫描，攻击树会在这里展开</div>
        </div>
      )}
      <div className="tree-legend">
        <span>
          <i style={{ background: verdictColor.compliance }} /> 突破
        </span>
        <span>
          <i style={{ background: verdictColor.partial }} /> 部分响应
        </span>
        <span>
          <i style={{ background: verdictColor.refusal }} /> 拒绝
        </span>
        <span>
          <i style={{ background: verdictColor.uncertain, opacity: 0.4 }} /> 误差 / 不可判定
        </span>
        <span>半径 = 代数 · 柱高 = 适应度</span>
      </div>
    </div>
  )
}

/** Minimal canvas-texture label. Sprites keep family names readable at any angle. */
function textSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = '600 30px system-ui, sans-serif'
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text.slice(0, 9), canvas.width / 2, canvas.height / 2)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  return new THREE.Sprite(material)
}