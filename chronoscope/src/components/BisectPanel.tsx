import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  METRICS,
  answer,
  candidateRange,
  culprit,
  findCrossing,
  metricValue,
  nextCandidate,
  remaining,
  type ManualState,
  type Metric
} from '../bisect'
import type { History } from '../history'
import { fmtDateTime, fmtInt, shortSha } from '../format'

export interface BisectResult {
  /** First bad row, when known. */
  culprit: number | null
  /** Files differing between the last good and first bad stop. */
  suspects: number[]
  /** Candidate interval to band on the timeline, or null when idle. */
  band: [number, number] | null
}

interface Props {
  history: History
  /** Row the playhead is on, so "mark good/bad" can default sensibly. */
  row: number
  onGoTo: (row: number) => void
  onResult: (result: BisectResult) => void
  onClose: () => void
}

type Mode = 'manual' | 'threshold'

export function BisectPanel({ history, row, onGoTo, onResult, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('manual')

  // --- manual ---
  const [state, setState] = useState<ManualState | null>(null)
  const candidate = state ? nextCandidate(state) : null
  const found = state ? culprit(state) : null
  const [range, setRange] = useState<[number, number]>([0, 0])

  // --- threshold ---
  const [metric, setMetric] = useState<Metric>('totalLines')
  const [threshold, setThreshold] = useState(1000)
  const [path, setPath] = useState('')
  const spec = METRICS.find(m => m.key === metric)!
  const crossing = useMemo(
    () => (mode === 'threshold' ? findCrossing(history, metric, threshold, path) : null),
    [mode, history, metric, threshold, path]
  )

  const beginManual = () => {
    // Default to a window around the playhead so the first question is useful
    // instead of spanning the entire history.
    const lo = Math.max(0, row - 64)
    const hi = Math.min(history.sampleCount - 1, row + 64)
    const next: ManualState = { good: lo, bad: hi, answers: [] }
    setState(next)
    setRange(candidateRange(next))
    onGoTo(nextCandidate(next) ?? lo)
  }

  const respond = useCallback(
    (good: boolean) => {
      if (!state || candidate === null) return
      const next = answer(state, candidate, good)
      setState(next)
      const interval = candidateRange(next)
      setRange(interval)
      const nextUp = nextCandidate(next)
      if (nextUp !== null) onGoTo(nextUp)
      else {
        const c = culprit(next)
        if (c !== null)
          onResult({ culprit: c, suspects: history.changedBetween(next.good, c), band: interval })
      }
    },
    [state, candidate, history, onGoTo, onResult]
  )

  // `b` toggles the panel, so the verdicts take y/n rather than git's g/b.
  useEffect(() => {
    if (candidate === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select')) return
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        respond(true)
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        respond(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [candidate, respond])

const abandon = () => {
    setState(null)
    setRange([0, 0])
    onResult({ culprit: null, suspects: [], band: null })
  }

  const applyThreshold = () => {
    if (crossing === null) {
      onResult({ culprit: null, suspects: [], band: null })
      return
    }
    const lo = Math.max(0, crossing - 1)
    onResult({
      culprit: crossing,
      suspects: history.changedBetween(lo, crossing),
      band: [lo, crossing]
    })
    onGoTo(crossing)
  }

  const total = history.sampleCount
  const span = Math.max(1, range[1] - range[0])

  return (
    <aside className="bisect glass" aria-label="二分查找">
      <header className="bisect-head">
        <div className="bisect-modes" role="group" aria-label="查找模式">
          <button
            type="button"
            className={mode === 'manual' ? 'seg active' : 'seg'}
            onClick={() => setMode('manual')}
          >
            手动二分
          </button>
          <button
            type="button"
            className={mode === 'threshold' ? 'seg active' : 'seg'}
            onClick={() => setMode('threshold')}
          >
            阈值查找
          </button>
        </div>
        <button type="button" className="filepanel-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </header>

      {mode === 'manual' ? (
        !state ? (
          <div className="bisect-body">
            <p className="bisect-lede">
              标出一个已知良好的 commit 和一个已知有问题的 commit，剩下交给二分。
              应用只做减法，不 checkout —— 测试要你在自己的终端里跑。
            </p>
            <button type="button" className="bisect-primary" onClick={beginManual}>
              从当前 commit 附近开始
            </button>
            <p className="bisect-hint">
              以当前第 {row + 1} 个停靠点为中心，取前后各 64 个作为区间。
            </p>
          </div>
        ) : (
          <div className="bisect-body">
            <div className="bisect-progress">
              <div className="bisect-bar">
                <div
                  className="bisect-bar-fill"
                  style={{
                    left: `${((range[0] - state.good) / Math.max(1, state.bad - state.good)) * 100}%`,
                    width: `${(span / Math.max(1, state.bad - state.good)) * 100}%`
                  }}
                />
              </div>
              <div className="bisect-progress-text">
                候选 {fmtInt(span)} / {fmtInt(state.bad - state.good)} ·还差{' '}
                {fmtInt(remaining(state))} 问
              </div>
            </div>

            {candidate !== null ? (
              <>
                <div className="bisect-question">这个 commit 还好吗？</div>
                <div className="bisect-commit">
                  <div className="mono">
                    {shortSha(history.samples[candidate].oid)} ·{' '}
                    {fmtDateTime(history.samples[candidate].timestamp)}
                  </div>
                  <div className="bisect-msg">{history.samples[candidate].message}</div>
                </div>
                <div className="bisect-actions">
                  <button type="button" className="btn-good" onClick={() => respond(true)}>
                    良好 (Y)
                  </button>
                  <button type="button" className="btn-bad" onClick={() => respond(false)}>
                    有问题 (N)
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="bisect-verdict">找到了</div>
                <div className="bisect-commit">
                  <div className="mono">
                    {shortSha(history.samples[found!].oid)} ·{' '}
                    {fmtDateTime(history.samples[found!].timestamp)}
                  </div>
                  <div className="bisect-msg">{history.samples[found!].message}</div>
                </div>
                <p className="bisect-hint">
                  城中高亮的 {fmtInt(history.changedBetween(state.good, found!).length)} 个文件
                  是这段区间里唯一变过的东西。
                </p>
              </>
            )}

            <button type="button" className="bisect-abandon" onClick={abandon}>
              重来
            </button>
          </div>
        )
      ) : (
        <div className="bisect-body">
          <p className="bisect-lede">
            不需要你回答任何问题：直接找出某个指标第一次越过阈值的那个 commit。
          </p>
          <label className="bisect-field">
            <span>指标</span>
            <select
              value={metric}
              onChange={e => setMetric(e.target.value as Metric)}
              aria-label="指标"
            >
              {METRICS.map(m => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          {spec.needsPath ? (
            <label className="bisect-field">
              <span>路径</span>
              <input
                type="text"
                value={path}
                placeholder="src/main.rs"
                onChange={e => setPath(e.target.value)}
                aria-label="文件路径"
              />
            </label>
          ) : null}

          <label className="bisect-field">
            <span>阈值（{spec.unit}）</span>
            <input
              type="number"
              min={0}
              value={threshold}
              onChange={e => setThreshold(Math.max(0, Number(e.target.value) || 0))}
              aria-label="阈值"
            />
          </label>

          <div className="bisect-readout">
            {crossing === null ? (
              <span className="bisect-none">
                {history.sampleCount === 0
                  ? '没有数据'
                  : `整条时间轴都没到 ${fmtInt(threshold)}`}
              </span>
            ) : (
              <>
                <div className="bisect-verdict">第 {fmtInt(crossing + 1)} 个停靠点首次达到</div>
                <div className="bisect-commit">
                  <div className="mono">
                    {shortSha(history.samples[crossing].oid)} ·{' '}
                    {fmtDateTime(history.samples[crossing].timestamp)}
                  </div>
                  <div className="bisect-msg">{history.samples[crossing].message}</div>
                  <div className="bisect-metric mono">
                    {fmtInt(metricValue(history, metric, crossing, path))} {spec.unit}
                  </div>
                </div>
                <button type="button" className="bisect-primary" onClick={applyThreshold}>
                  高亮这一步变化的文件
                </button>
              </>
            )}
          </div>
          <p className="bisect-hint">整条时间轴共 {fmtInt(total)} 个停靠点。</p>
        </div>
      )}
    </aside>
  )
}
