import type { FamilyStat, Finding } from '../types'
import { severityColor } from '../palette'
import { percent, severityZh } from '../format'

/**
 * Defence report. Each finding names a mechanism, states the evidence, and
 * proposes a specific change — the point of the whole tool. Ordered by severity,
 * and a run with no findings says so explicitly rather than showing an empty
 * list that reads as a bug.
 */
export function FindingsList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return (
      <div className="empty">
        <h2>本次运行未发现突破</h2>
        <div>所有探测均被拒绝或未产生可判定信号。</div>
        <div style={{ fontSize: 11, maxWidth: 460 }}>
          注意：这不等于安全。攻击族覆盖有限，且判定依赖启发式与判定模型两个通道。
          提高代数、补充自定义攻击族，并确认判定端点与被测端点不是同一个模型。
        </div>
      </div>
    )
  }
  return (
    <div>
      {findings.map((f, i) => (
        <div className="finding" key={`${f.title}-${i}`}>
          <div className="sev" style={{ color: severityColor[f.severity] }}>
            {severityZh(f.severity)}
          </div>
          <div style={{ minWidth: 0 }}>
            <h3>{f.title}</h3>
            <p>{f.detail}</p>
            <p className="fix">{f.recommendation}</p>
            {f.evidence.length > 0 && (
              <div className="evidence">
                {f.evidence.map(id => (
                  <code key={id}>{id}</code>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Family breakdown as a stacked bar. Refusals are shown in a de-emphasised
 * tone so a 100%-green row reads as "held" rather than as a visual highlight.
 */
export function FamilyTable({ stats }: { stats: FamilyStat[] }) {
  const sorted = [...stats].sort(
    (a, b) => severityRankRate(b.successRate) - severityRankRate(a.successRate) || a.family.localeCompare(b.family)
  )
  return (
    <div>
      {sorted.map(s => {
        const total = Math.max(1, s.attempts)
        const pct = (n: number) => `${(n / total) * 100}%`
        return (
          <div className="bar-row" key={s.family}>
            <span className="name" title={s.family}>
              {s.family}
            </span>
            <span className="bar-track" title={`突破 ${s.breaks} / 部分 ${s.partial} / 拒绝 ${s.refusals} / 误差 ${s.errors}`}>
              <span className="break" style={{ width: pct(s.breaks) }} />
              <span className="partial" style={{ width: pct(s.partial) }} />
              <span className="refusal" style={{ width: pct(s.refusals) }} />
            </span>
            <span className="counts">
              {s.breaks}/{s.attempts} · {percent(s.successRate)}
              {s.errors > 0 && <span style={{ color: 'var(--partial)' }}> · {s.errors} 误差</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function severityRankRate(rate: number): number {
  return rate
}