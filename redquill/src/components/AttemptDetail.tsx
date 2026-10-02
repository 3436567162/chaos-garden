import { useState } from 'react'
import { Copy, X } from 'lucide-react'
import type { Attempt } from '../types'
import { VerdictChip } from './VerdictChip'
import { ConfidenceMeter } from './ConfidenceMeter'
import { duration, percent } from '../format'
import { verdictColor } from '../palette'

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="btn ghost sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        } catch {
          // Clipboard access is denied in some webview configurations; the text
          // is selectable on screen regardless, so this is not worth a modal.
          setDone(false)
        }
      }}
    >
      <Copy size={11} />
      {done ? '已复制' : '复制可复现工件'}
    </button>
  )
}

/** Everything needed to re-run one probe by hand, as plain text. */
function artefact(attempt: Attempt): string {
  const lines = [
    `probe: ${attempt.probeId}`,
    `family: ${attempt.family}`,
    `operators: ${attempt.operators.length ? attempt.operators.join(', ') : '(none)'}`,
    `verdict: ${attempt.verdict.label} @ ${attempt.verdict.confidence.toFixed(2)}${attempt.verdict.disputed ? ' (disputed)' : ''}`,
    '',
    '--- messages ---',
    ...attempt.messages.map(m => `[${m.role}]\n${m.content}`),
    '',
    '--- response ---',
    attempt.response
  ]
  return lines.join('\n')
}

/**
 * Full detail for one attempt: the exact prompt, the exact response, and both
 * judge channels with their evidence. A finding that cannot be inspected is
 * not a finding, it is a number.
 */
export function AttemptDetail({ attempt, onClose }: { attempt: Attempt; onClose: () => void }) {
  const v = attempt.verdict

  return (
    <div className="detail">
      <div className="detail-head">
        <strong className="mono" style={{ fontSize: 12 }}>
          {attempt.probeId}
        </strong>
        <span className="chip">{attempt.family}</span>
        {attempt.operators.map(op => (
          <span key={op} className="chip mono">
            {op}
          </span>
        ))}
        {attempt.rewritten && <span className="chip">LLM 改写</span>}
        <span style={{ flex: 1 }} />
        <CopyButton text={artefact(attempt)} />
        <button type="button" className="btn ghost sm" onClick={onClose}>
          <X size={12} />
          关闭
        </button>
      </div>

      {attempt.error && <div className="notice err">请求失败：{attempt.error}</div>}

      <div className="transcript">
        <section>
          <h4>发往目标的完整对话</h4>
          <pre>{attempt.messages.map(m => `[${m.role}]\n${m.content}`).join('\n\n')}</pre>
        </section>
        <section>
          <h4>目标原始响应</h4>
          <pre>{attempt.response || '(空响应)'}</pre>
        </section>
      </div>

      <div className="channel-grid">
        <div className="channel">
          <div className="name">
            <span>启发式通道</span>
            <span style={{ color: verdictColor[v.heuristic.label] }}>{v.heuristic.label}</span>
          </div>
          <ConfidenceMeter label={v.heuristic.label} value={v.heuristic.score} />
          {v.heuristic.signals.length > 0 ? (
            <ul>
              {v.heuristic.signals.slice(0, 8).map(s => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          ) : (
            <div className="reason">未命中任何标记词</div>
          )}
          {v.heuristic.evasionMarkers.length > 0 && (
            <>
              <div className="name" style={{ marginTop: 9 }}>
                <span>输出侧规避痕迹</span>
              </div>
              <ul>
                {v.heuristic.evasionMarkers.map(m => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="channel">
          <div className="name">
            <span>判定模型通道</span>
            <span style={{ color: verdictColor[v.label] }}>一致度 {percent(v.voteConsensus)}</span>
          </div>
          {v.votes.length === 0 ? (
            <div className="reason">未启用，或判定端点不可达——本次结论置信度已被上限压到 0.6。</div>
          ) : (
            v.votes.map((vote, i) => (
              <div key={i}>
                <div className="reason">
                  <span style={{ color: verdictColor[vote.label] }}>{vote.label}</span>
                  {' · '}
                  {vote.score.toFixed(2)}
                  {vote.reason ? ` · ${vote.reason}` : ''}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="channel">
          <div className="name">
            <span>融合结果</span>
            <VerdictChip label={v.label} disputed={v.disputed} />
          </div>
          <div style={{ color: 'var(--faint)', fontSize: 11, lineHeight: 1.6 }}>
            置信度 <b style={{ color: 'var(--ink)' }}>{v.confidence.toFixed(2)}</b>
            <br />
            通道一致 {v.disputed ? '否' : '是'}
            <br />
            适应度 {attempt.fitness.toFixed(3)} · 延迟 {duration(attempt.latencyMs)} · 第 {attempt.generation + 1} 代
          </div>
        </div>
      </div>
    </div>
  )
}