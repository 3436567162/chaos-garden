import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CommitBar } from './components/CommitBar'
import { Legend } from './components/Legend'
import { BASE_STEP_MS, Playback, type Speed } from './components/Playback'
import { Timeline } from './components/Timeline'
import { buildMockTimeline } from './mock'
import { CityScene } from './three/CityScene'
import { computeLayout } from './three/layout'
import { TRANSITION_MS } from './three/morph'

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

  const stepMs = BASE_STEP_MS / speed
  // At high speeds the morph must finish before the next commit arrives.
  const transitionMs = playing ? Math.min(TRANSITION_MS, stepMs * 0.8) : TRANSITION_MS
  const transitionRef = useRef(transitionMs)
  transitionRef.current = transitionMs

  useEffect(() => {
    const scene = new CityScene(stageRef.current!)
    sceneRef.current = scene
    return () => {
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    sceneRef.current?.setLayout(layout)
  }, [layout])

  useEffect(() => {
    sceneRef.current?.show(snapshot, transitionRef.current)
  }, [snapshot, layout])

  useEffect(() => {
    if (!playing) return
    if (index >= count - 1) {
      setPlaying(false)
      return
    }
    const id = window.setTimeout(() => setIndex(i => Math.min(count - 1, i + 1)), stepMs)
    return () => window.clearTimeout(id)
  }, [playing, index, count, stepMs])

  const togglePlay = useCallback(() => {
    if (!playing && index >= count - 1) setIndex(0)
    setPlaying(!playing)
  }, [playing, index, count])

  const scrub = useCallback((i: number) => {
    setPlaying(false)
    setIndex(i)
  }, [])

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
        onChange={scrub}
        controls={<Playback playing={playing} speed={speed} onToggle={togglePlay} onSpeed={setSpeed} />}
      />
    </div>
  )
}
