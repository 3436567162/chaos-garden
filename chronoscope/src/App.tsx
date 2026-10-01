import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CommitBar } from './components/CommitBar'
import { Legend } from './components/Legend'
import { BASE_STEP_MS, Playback, type Speed } from './components/Playback'
import { Timeline } from './components/Timeline'
import { buildMockTimeline } from './mock'
import { CityScene } from './three/CityScene'
import { computeLayout } from './three/layout'

export default function App() {
  const timeline = useMemo(buildMockTimeline, [])
  const count = timeline.snapshots.length
  const layout = useMemo(
    () => computeLayout(timeline.snapshots.flatMap(s => s.files.map(f => f.path))),
    [timeline]
  )
  const [index, setIndex] = useState(count - 1)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(1)
  const snapshot = timeline.snapshots[index]

  const stageRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CityScene | null>(null)
  /**
   * The scene only exists after mount, and child effects run before parent
   * ones — so the timeline's subscription has to be able to re-run once the
   * scene shows up, otherwise it silently receives no frames at all.
   */
  const [scene, setScene] = useState<CityScene | null>(null)

  /**
   * Playback position is a continuous coordinate in snapshot space, not a commit
   * counter: 3.5 means "halfway between commit 3 and commit 4". Both the 3D city
   * and the timeline playhead read from it, so a drag can park anywhere and
   * playback can stay in motion without either one snapping.
   */
  const posRef = useRef(count - 1)
  /** Commit the 3D is heading toward; changes at most once per commit. */
  const shownRef = useRef(count - 1)
  /** Authoritative play state, set synchronously so the frame tick never races a click. */
  const playingRef = useRef(false)

  useEffect(() => {
    const created = new CityScene(stageRef.current!)
    sceneRef.current = created
    setScene(created)
    return () => {
      created.dispose()
      if (sceneRef.current === created) sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    sceneRef.current?.setLayout(layout)
  }, [layout])

  /** Draws whatever `posRef` currently points at. */
  const renderAt = useCallback(
    (pos: number, staggered: boolean) => {
      const scene = sceneRef.current
      const snaps = timeline.snapshots
      if (!scene || snaps.length === 0) return
      const lastIdx = snaps.length - 1
      const lo = Math.min(lastIdx, Math.max(0, Math.floor(pos)))
      const hi = Math.min(lastIdx, lo + 1)
      scene.showAt(snaps[lo], snaps[hi], pos - lo, staggered)
    },
    [timeline.snapshots]
  )

  // Covers first paint and layout rebuilds; scrubbing renders directly.
  useEffect(() => {
    if (playingRef.current) return
    renderAt(posRef.current, false)
  }, [renderAt, layout, index])

  useEffect(() => {
    if (!playing || !scene) return
    const lastIdx = count - 1
    const unsub = scene.onTick(dt => {
      const pos = posRef.current + (dt / BASE_STEP_MS) * speed
      posRef.current = pos
      if (pos >= lastIdx) {
        posRef.current = lastIdx
        playingRef.current = false
        setPlaying(false)
      }
      renderAt(posRef.current, true)
      const i = Math.min(lastIdx, Math.floor(posRef.current))
      if (i !== shownRef.current) {
        shownRef.current = i
        setIndex(i)
      }
    })
    return () => unsub?.()
  }, [playing, speed, count, renderAt, scene])

  // Stable handle so the timeline can subscribe to the render loop without
  // resubscribing on every React render; it changes only when the scene is
  // created or destroyed.
  const subscribeFrames = useCallback(
    (cb: (dt: number) => void) => (scene ? scene.onTick(cb) : () => {}),
    [scene]
  )

  const togglePlay = useCallback(() => {
    if (playingRef.current) {
      playingRef.current = false
      setPlaying(false)
      return
    }
    if (posRef.current >= count - 1) {
      posRef.current = 0
      shownRef.current = 0
      setIndex(0)
      renderAt(0, false)
    }
    playingRef.current = true
    setPlaying(true)
  }, [count, renderAt])

  /** Parks the playhead at any fractional position and stops playback. */
  const scrub = useCallback(
    (pos: number) => {
      playingRef.current = false
      setPlaying(false)
      const clamped = Math.max(0, Math.min(count - 1, pos))
      posRef.current = clamped
      const i = Math.floor(clamped)
      shownRef.current = i
      setIndex(i)
      renderAt(clamped, false)
    },
    [count, renderAt]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, button')) return
      e.preventDefault()
      togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay])

  return (
    <div className="app">
      <div className="stage-canvas" ref={stageRef} />
      <div className="vignette" />
      <CommitBar repoName={timeline.repoName} snapshot={snapshot} index={index} count={count}>
        <Legend snapshot={snapshot} />
      </CommitBar>
      <div className="stage-hint">空格 播放/暂停 · 拖拽 旋转 · 右键 平移 · 滚轮 缩放</div>
      <Timeline
        snapshots={timeline.snapshots}
        index={index}
        positionRef={posRef}
        subscribe={subscribeFrames}
        onChange={scrub}
        controls={<Playback playing={playing} speed={speed} onToggle={togglePlay} onSpeed={setSpeed} />}
      />
    </div>
  )
}
