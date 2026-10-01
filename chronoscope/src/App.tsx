import { useCallback, useEffect, useRef, useState } from 'react'
import { CommitBar } from './components/CommitBar'
import { Legend } from './components/Legend'
import { BASE_STEP_MS, Playback, type Speed } from './components/Playback'
import { StartScreen } from './components/StartScreen'
import { Timeline } from './components/Timeline'
import { History } from './history'
import {
  errorMessage,
  isTauri,
  onScanProgress,
  pickFolder,
  scanRepository
} from './lib'
import { buildMockScan } from './mock'
import { CityScene } from './three/CityScene'
import type { ScanProgress } from './types'

export default function App() {
  const [history, setHistory] = useState<History | null>(null)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [scanPath, setScanPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(1)

  const stageRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CityScene | null>(null)
  /**
   * The scene only exists after mount, and child effects run before parent
   * ones, so the timeline's subscription has to be able to re-run once the
   * scene shows up.
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
  const renderAt = useCallback(
    (pos: number, staggered: boolean) => {
      const target = sceneRef.current
      const h = historyRef.current
      if (!target || !h) return
      const clamped = Math.max(0, Math.min(lastRef.current, pos))
      const lo = Math.min(lastRef.current, Math.floor(clamped))
      const hi = Math.min(lastRef.current, lo + 1)
      target.showAt(h, lo, hi, clamped - lo, staggered)
    },
    []
  )

  // Refs so renderAt stays stable while still seeing the current values.
  const historyRef = useRef<History | null>(null)
  historyRef.current = history
  const lastRef = useRef(last)
  lastRef.current = last

  useEffect(() => {
    sceneRef.current?.setLayout(history?.layout ?? null)
    if (history) {
      posRef.current = last
      shownRef.current = last
      setIndex(last)
      renderAt(last, false)
    }
  }, [history, last, renderAt])

  useEffect(() => {
    if (!playing || !scene || !history) return
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

  // Stable handle so the timeline can subscribe to the render loop without
  // resubscribing on every React render.
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
    if (posRef.current >= lastRef.current) {
      posRef.current = 0
      shownRef.current = 0
      setIndex(0)
      renderAt(0, false)
    }
    playingRef.current = true
    setPlaying(true)
  }, [renderAt])

  /** Parks the playhead at any fractional position and stops playback. */
  const scrub = useCallback(
    (pos: number) => {
      playingRef.current = false
      setPlaying(false)
      const clamped = Math.max(0, Math.min(lastRef.current, pos))
      posRef.current = clamped
      const i = Math.floor(clamped)
      shownRef.current = i
      setIndex(i)
      renderAt(clamped, false)
    },
    [renderAt]
  )

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

  const showStart = !history

  return (
    <div className="app">
      <div className="stage-canvas" ref={stageRef} />
      <div className="vignette" />
      {history ? (
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
            绌烘牸 鎾斁/鏆傚仠 路 鎷栨嫿 鏃嬭浆 路 鍙抽敭 骞崇Щ 路 婊氳疆 缂╂斁
          </div>
          <Timeline
            samples={history.samples}
            totals={history.totals}
            index={index}
            positionRef={posRef}
            subscribe={subscribeFrames}
            onChange={scrub}
            controls={
              <Playback
                playing={playing}
                speed={speed}
                onToggle={togglePlay}
                onSpeed={setSpeed}
              />
            }
          />
        </>
      ) : null}
      {showStart ? (
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
        <div className="start-hint">娴忚鍣ㄩ瑙堟ā寮忥細鍙兘鏌ョ湅婕旂ず鏁版嵁</div>
      ) : null}
    </div>
  )
}