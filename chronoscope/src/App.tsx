import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CommitBar } from './components/CommitBar'
import { FilePanel } from './components/FilePanel'
import { Legend } from './components/Legend'
import { Playback, BASE_STEP_MS, type Speed } from './components/Playback'
import { SearchBox } from './components/SearchBox'
import { StartScreen } from './components/StartScreen'
import { Stats } from './components/Stats'
import { Timeline } from './components/Timeline'
import { Tooltip } from './components/Tooltip'
import { History } from './history'
import {
  errorMessage,
  isTauri,
  onScanProgress,
  pickFolder,
  scanRepository,
  writeBenchLog
} from './lib'
import { buildMockScan } from './mock'
import { makeStressScan, stressSlotsFromEnv } from './stress'
import { CityScene, type FrameStats, type Pick } from './three/CityScene'
import type { ScanProgress } from './types'

/** How long the entrance sweep takes when a repository first appears. */
const ENTRANCE_MS = 1500

/** Stops generated in stress mode; fewer keeps the state grid's memory sane. */
const STRESS_SAMPLES = 120

export default function App() {
  /** Non-zero when VITE_CHRONOSCOPE_STRESS asks for a synthetic city. */
  const stressSlots = useMemo(stressSlotsFromEnv, [])
  const [history, setHistory] = useState<History | null>(null)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [scanPath, setScanPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(1)
  const [hover, setHover] = useState<Pick | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [showStats, setShowStats] = useState(stressSlots > 0)

  // Stress mode skips the start screen entirely: there is nothing to pick.
  useEffect(() => {
    if (stressSlots > 0) setHistory(new History(makeStressScan(stressSlots, STRESS_SAMPLES)))
  }, [stressSlots])

  const stageRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CityScene | null>(null)
  /**
   * The scene only exists after mount, and child effects run before parent
   * ones, so subscriptions have to be able to re-run once the scene shows up.
   */
  const [scene, setScene] = useState<CityScene | null>(null)

  /**
   * Playback position is a continuous coordinate in sample space, not a commit
   * counter: 3.5 means "halfway between stop 3 and stop 4". Both the city and
   * the timeline playhead read from it, so a drag can park anywhere.
   */
  const posRef = useRef(0)
  const shownRef = useRef(0)
  /** Authoritative play state, set synchronously so a frame never races a click. */
  const playingRef = useRef(false)
  /** Non-null while the opening sweep is playing; holds its start position. */
  const entranceRef = useRef<{ from: number; elapsed: number } | null>(null)

  useEffect(() => {
    const created = new CityScene(stageRef.current!)
    sceneRef.current = created
    setScene(created)
    return () => {
      created.dispose()
      if (sceneRef.current === created) sceneRef.current = null
    }
  }, [])

  const count = history?.sampleCount ?? 0
  const last = Math.max(0, count - 1)

  /** Draws whatever `posRef` currently points at. */
  const renderAt = useCallback((pos: number, staggered: boolean) => {
    const target = sceneRef.current
    const h = historyRef.current
    if (!target || !h) return
    const clamped = Math.max(0, Math.min(lastRef.current, pos))
    const lo = Math.min(lastRef.current, Math.floor(clamped))
    const hi = Math.min(lastRef.current, lo + 1)
    target.showAt(h, lo, hi, clamped - lo, staggered)
  }, [])

  // Refs so renderAt stays stable while still seeing current values.
  const historyRef = useRef<History | null>(null)
  historyRef.current = history
  const lastRef = useRef(last)
  lastRef.current = last

  // New repository: rebuild the city, park on the last commit, then sweep in.
  useEffect(() => {
    if (!history) return
    sceneRef.current?.setLayout(history.layout)
    setSelected(null)
    setHover(null)
    posRef.current = last
    shownRef.current = last
    setIndex(last)
    entranceRef.current = { from: 0, elapsed: 0 }
    renderAt(0, false)
  }, [history, last, renderAt])

  useEffect(() => {
    if (!playing || !scene || !history || entranceRef.current) return
    const unsub = scene.onTick(dt => {
      const pos = posRef.current + (dt / BASE_STEP_MS) * speed
      posRef.current = pos
      if (pos >= lastRef.current) {
        posRef.current = lastRef.current
        playingRef.current = false
        setPlaying(false)
      }
      renderAt(posRef.current, true)
      const i = Math.min(lastRef.current, Math.floor(posRef.current))
      if (i !== shownRef.current) {
        shownRef.current = i
        setIndex(i)
      }
    })
    return () => unsub()
  }, [playing, speed, scene, history, renderAt])

  // Opening sweep: sample 0 to HEAD in one gesture, then hands over to the user.
  useEffect(() => {
    if (!scene || !history) return
    const unsub = scene.onTick(dt => {
      const run = entranceRef.current
      if (!run) return
      run.elapsed += dt
      const t = Math.min(1, run.elapsed / ENTRANCE_MS)
      // Ease out so the city decelerates into its final shape.
      const eased = 1 - Math.pow(1 - t, 3)
      const pos = run.from + (lastRef.current - run.from) * eased
      posRef.current = pos
      renderAt(pos, true)
      const i = Math.min(lastRef.current, Math.floor(pos))
      if (i !== shownRef.current) {
        shownRef.current = i
        setIndex(i)
      }
      if (t >= 1) {
        entranceRef.current = null
        posRef.current = lastRef.current
        shownRef.current = lastRef.current
        setIndex(lastRef.current)
        renderAt(lastRef.current, false)
      }
    })
    return () => unsub()
  }, [scene, history, renderAt])

  useEffect(() => {
    if (!scene) return
    const offHover = scene.onHover(setHover)
    const offClick = scene.onClick(pick => setSelected(pick.slot))
    return () => {
      offHover()
      offClick()
    }
  }, [scene])

  // Stable handle for the stats overlay, which subscribes on its own.
  const subscribeStats = useCallback(
    (cb: (s: FrameStats) => void) => (scene ? scene.onStats(cb) : () => {}),
    [scene]
  )

  // Benchmark mode: one line per second so a stress run can be read back from
  // the dev log instead of scraped off the screen.
  useEffect(() => {
    if (!scene || stressSlots <= 0) return
    let last = 0
    return scene.onStats(s => {
      if (s.fps <= 0) return
      const now = performance.now()
      if (now - last < 1000) return
last = now
      writeBenchLog(
        `blocks=${s.instances} fps=${s.fps.toFixed(1)} ` +
          `frame=${s.frameMs.toFixed(2)}ms worst=${s.worstMs.toFixed(1)}ms ` +
          `draws=${s.drawCalls} tris=${s.triangles} progs=${s.programs}`
      )
    })
  }, [scene, stressSlots])

  // Stable handle so the timeline can subscribe to the render loop without
  // resubscribing on every React render.
  const subscribeFrames = useCallback(
    (cb: (dt: number) => void) => (scene ? scene.onTick(cb) : () => {}),
    [scene]
  )

  const stopAll = useCallback(() => {
    playingRef.current = false
    setPlaying(false)
    entranceRef.current = null
  }, [])

  const togglePlay = useCallback(() => {
    if (entranceRef.current) stopAll()
    if (playingRef.current) {
      stopAll()
      return
    }
    if (posRef.current >= lastRef.current) {
      posRef.current = 0
      shownRef.current = 0
      setIndex(0)
      renderAt(0, false)
    }
    playingRef.current = true
    setPlaying(true)
  }, [renderAt, stopAll])

  /** Parks the playhead at any fractional position and stops playback. */
  const scrub = useCallback(
    (pos: number) => {
      stopAll()
      const clamped = Math.max(0, Math.min(lastRef.current, pos))
      posRef.current = clamped
      const i = Math.floor(clamped)
      shownRef.current = i
      setIndex(i)
      renderAt(clamped, false)
    },
    [renderAt, stopAll]
  )

  /** Jumps to a whole sample, the way keyboard stepping and search both want. */
  const goTo = useCallback(
    (row: number) => {
      scrub(Math.max(0, Math.min(lastRef.current, Math.round(row))))
    },
    [scrub]
  )

  const step = useCallback(
    (delta: number) => {
      const base = Math.round(posRef.current)
      goTo(base + delta)
    },
    [goTo]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.closest('input, textarea, select')
      if (typing) return

      if (e.code === 'Space') {
        if (e.repeat) return
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        step(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        step(1)
      } else if (e.key === 'Home') {
        e.preventDefault()
        goTo(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        goTo(lastRef.current)
      } else if (e.key === 'Escape') {
        setSelected(null)
      } else if (e.key === '`') {
        setShowStats(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, step, goTo])

  const openRepo = useCallback(async () => {
    setError(null)
    try {
      const picked = await pickFolder()
      if (!picked) return
      setScanPath(picked)
      setProgress({ phase: 'commits', done: 0, total: 0 })
      const unlisten = await onScanProgress(setProgress)
      try {
        const result = await scanRepository(picked)
        setHistory(new History(result))
      } finally {
        unlisten()
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setProgress(null)
      setScanPath('')
    }
  }, [])

  const openDemo = useCallback(() => {
    setError(null)
    setHistory(new History(buildMockScan()))
  }, [])

  return (
    <div className="app">
      <div className="stage-canvas" ref={stageRef} />
      <div className="vignette" />
      {history && history.slots === 0 ? (
        <StartScreen
          progress={null}
          path=""
          error={`${history.repoName} 里没有可显示的文件：所有被跟踪的文件都落在被忽略的目录里。`}
          onOpen={() => void openRepo()}
          onDemo={openDemo}
          onDismiss={() => setError(null)}
        />
      ) : null}
      {history && history.slots > 0 ? (
        <>
          <CommitBar
            repoName={history.repoName}
            sample={history.samples[index]}
            files={history.fileCounts[index]}
            lines={history.totals[index]}
            index={index}
            count={count}
          >
            <Legend history={history} row={index} />
          </CommitBar>
          <div className="stage-hint">
            空格 播放/暂停 · ←→ 逐 commit · Home/End 首尾 · 悬停查看文件 · 点击查看修改史 · 空格外
            单击空白取消选择
          </div>
          {selected !== null ? (
            <FilePanel
              history={history}
              slot={selected}
              row={index}
              onPickRow={goTo}
              onClose={() => setSelected(null)}
            />
          ) : null}
          <Timeline
            samples={history.samples}
            totals={history.totals}
            index={index}
            positionRef={posRef}
            subscribe={subscribeFrames}
            onChange={scrub}
            controls={
              <div className="timeline-controls">
                <Playback
                  playing={playing}
                  speed={speed}
                  onToggle={togglePlay}
                  onSpeed={setSpeed}
                />
                <SearchBox history={history} onPick={goTo} />
              </div>
            }
          />
          <Tooltip history={history} row={index} pick={hover} />
          {showStats ? (
            <Stats
              subscribe={subscribeStats}
              label={stressSlots > 0 ? `压力测试 · ${history.repoName}` : history.repoName}
            />
          ) : null}
        </>
      ) : null}
      {!history ? (
        <StartScreen
          progress={progress}
          path={scanPath}
          error={error}
          onOpen={() => void openRepo()}
          onDemo={openDemo}
          onDismiss={() => setError(null)}
        />
      ) : null}
      {!history && !isTauri() ? (
        <div className="start-hint">浏览器预览模式：只能查看演示数据</div>
      ) : null}
    </div>
  )
}