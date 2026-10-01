// Commit range search.
//
// Two modes, sharing one shape:
//
//   manual   git's own bisect. You mark a stop good or bad and the next stop to
//            test is the midpoint, so log2(n) questions instead of n. This
//            never checks anything out — you do that in your own terminal and
//            come back with an answer, which is honest about the fact that only
//            you can run the test.
//
//   threshold  fully automatic. Find the first stop where a metric crosses a
//            value: total lines, file count, or one file's line count. Answers
//            "when did this repo double" and "when did this file get big"
//            without leaving the app.
//
// The payoff of either mode is the same: the set of files that differ between
// the last good and the first bad stop, which is where the answer lives.

import type { History } from './history'

export type Metric = 'totalLines' | 'files' | 'fileLines'

export interface MetricSpec {
  key: Metric
  label: string
  /** Unit shown next to the threshold input. */
  unit: string
  needsPath: boolean
}

export const METRICS: MetricSpec[] = [
  { key: 'totalLines', label: '仓库总行数', unit: '行', needsPath: false },
  { key: 'files', label: '文件数', unit: '个', needsPath: false },
  { key: 'fileLines', label: '单个文件的行数', unit: '行', needsPath: true }
]

export function metricValue(history: History, metric: Metric, row: number, path?: string): number {
  switch (metric) {
    case 'totalLines':
      return history.totals[row] ?? 0
    case 'files':
      return history.fileCounts[row] ?? 0
    case 'fileLines': {
      if (!path) return 0
      const slot = history.slotOf(path)
      return slot === undefined ? 0 : history.linesAt(row, slot)
    }
  }
}

/** Manual bisect state. `good` is the newest known-good row, `bad` the oldest known-bad. */
export interface ManualState {
  good: number
  bad: number
  /** Verdicts so far, newest last, for the trail. */
  answers: { row: number; good: boolean }[]
}

/**
 * First row where `metric` reaches `threshold`, or null. Binary search, because
 * the metric is not guaranteed monotonic across history but is close enough that
 * the first crossing is what people mean.
 */
export function findCrossing(
  history: History,
  metric: Metric,
  threshold: number,
  path?: string
): number | null {
  const at = (row: number) => metricValue(history, metric, row, path)
  const first = at(0)
  if (first >= threshold) return 0
  const lastRow = history.sampleCount - 1
  if (at(lastRow) < threshold) return null

  let lo = 0
  let hi = lastRow
  // Invariant: at(lo) < threshold <= at(hi).
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (at(mid) >= threshold) hi = mid
    else lo = mid
  }
  return hi
}

/** The row a manual bisect should test next: the midpoint of the open interval. */
export function nextCandidate(state: ManualState): number | null {
  return state.bad - state.good <= 1 ? null : (state.good + state.bad) >> 1
}

/** Folds one verdict in, exactly as git narrows its range. */
export function answer(state: ManualState, row: number, good: boolean): ManualState {
  if (good) {
    return {
      good: row,
      bad: state.bad,
      answers: [...state.answers, { row, good }]
    }
  }
  return {
    good: state.good,
    bad: row,
    answers: [...state.answers, { row, good }]
  }
}

/** The first bad row, once the interval has collapsed to one candidate. */
export function culprit(state: ManualState): number | null {
  return state.bad - state.good === 1 ? state.bad : null
}

/** Rows still in play: everything after `good` up to and including `bad`. */
export function candidateRange(state: ManualState): [number, number] {
  return [state.good + 1, state.bad]
}

/** How many questions are left, the log2 of the interval. */
export function remaining(state: ManualState): number {
  let n = state.bad - state.good
  let steps = 0
  while (n > 1) {
    n >>= 1
    steps += 1
  }
  return steps
}