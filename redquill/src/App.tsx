import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Square, Shuffle, Cpu, Scale, Wand2 } from 'lucide-react'
import type { Attempt, Endpoint, FamilyInfo, JudgeConfig, ScanResult } from './types'
import { isErrorPayload } from './types'
import {
  cancelScan,
  errorMessage,
  isTauri,
  listFamilies,
  loadRun,
  onScanFinished,
  onScanProgress,
  startScan,
  suggestSeed
} from './lib'
import { EndpointFields, FamilyPicker } from './components/TargetPanel'
import { AttemptDetail } from './components/AttemptDetail'
import { VerdictChip } from './components/VerdictChip'
import { FamilyTable, FindingsList } from './components/Report'
import { HistoryList } from './components/History'
import { AttackTree } from './three/AttackTree'
import { compactNumber, duration, percent } from './format'

type Tab = 'probe' | 'tree' | 'report' | 'history'

const DEFAULT_ENDPOINT: Endpoint = {
  baseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  model: '',
  temperature: null,
  maxTokens: null,
  timeoutSecs: 60,
  extraHeaders: []
}

const DEFAULT_JUDGE: JudgeConfig = {
  enabled: true,
  endpoint: null,
  votes: 3,
  requireConsensus: false,
  cacheVerdicts: true
}

export default function App() {
  const [tab, setTab] = useState<Tab>('probe')
  const [families, setFamilies] = useState<FamilyInfo[]>([])
  const [selectedFamilies, setSelectedFamilies] = useState<string[]>([])

  // Probe configuration -------------------------------------------------
  const [objective, setObjective] = useState('')
  const [target, setTarget] = useState<Endpoint>(DEFAULT_ENDPOINT)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [judge, setJudge] = useState<JudgeConfig>(DEFAULT_JUDGE)
  const [useRewriter, setUseRewriter] = useState(false)
  const [rewriterModel, setRewriterModel] = useState('')
  const [population, setPopulation] = useState(12)
  const [generations, setGenerations] = useState(4)
  const [concurrency, setConcurrency] = useState(4)
  const [seed, setSeed] = useState<number | null>(null)
  const [authorised, setAuthorised] = useState(false)

  // Run state ----------------------------------------------------------
  const [result, setResult] = useState<ScanResult | null>(null)
  const [live, setLive] = useState<Attempt[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number; breaks: number } | null>(null)
  const [running, setRunning] = useState(false)
  const [runKey, setRunKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Attempt | null>(null)
  const [generationFilter, setGenerationFilter] = useState<number | null>(null)

  const liveRef = useRef<Attempt[]>([])

  const effectiveSeed = seed ?? 0x5eed1234abcd0001
  const budget = population * generations

  // Wiring -------------------------------------------------------------
  useEffect(() => {
    if (!isTauri()) return
    void listFamilies()
      .then(f => setFamilies(f))
      .catch(e => setError(errorMessage(e)))
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    let alive = true
    const offs: (() => void)[] = []
    void onScanProgress(p => {
      if (!alive) return
      setProgress({ done: p.done, total: p.total, breaks: p.breaks })
      if (p.latest) {
        liveRef.current = [...liveRef.current, p.latest]
        setLive(liveRef.current)
      }
      if (p.phase === 'evolving' || p.phase === 'cancelled') {
        setLive([...liveRef.current])
      }
    }).then(f => offs.push(f))
    void onScanFinished(payload => {
      if (!alive) return
      setRunning(false)
      setRunKey(null)
      if (isErrorPayload(payload)) {
        setError(payload.error)
        return
      }
      liveRef.current = []
      setLive([])
      setResult(payload)
      setTab('report')
    }).then(f => offs.push(f))
    return () => {
      alive = false
      offs.forEach(off => off())
    }
  }, [])

  const attempts = useMemo(() => result?.attempts ?? live, [result, live])

  const select = useCallback((a: Attempt) => {
    setSelected(a)
  }, [])

  // Actions ------------------------------------------------------------
  async function beginScan() {
    setError(null)
    setResult(null)
    liveRef.current = []
    setLive([])
    setProgress({ done: 0, total: budget, breaks: 0 })
    setRunning(true)
    setTab('probe')
    try {
      const key = await startScan({
        objective,
        target,
        judge,
        families: selectedFamilies,
        population,
        generations,
        concurrency,
        seed: effectiveSeed,
        systemPrompt: systemPrompt.trim() || null,
        authorised,
        rewriter:
          useRewriter && rewriterModel.trim()
            ? { ...target, model: rewriterModel.trim() }
            : null
      })
      setRunKey(key)
    } catch (e) {
      setRunning(false)
      setError(errorMessage(e))
    }
  }

  async function stopScan() {
    if (!runKey) return
    try {
      await cancelScan(runKey)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function openRun(runId: string) {
    setError(null)
    try {
      const loaded = await loadRun(runId)
      setResult(loaded)
      setLive([])
      liveRef.current = []
      setTarget(prev => ({ ...prev, model: loaded.targetModel }))
      setTab('report')
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function reseed() {
    try {
      setSeed(await suggestSeed())
    } catch {
      setSeed(Math.floor(Math.random() * 2 ** 48))
    }
  }

  const ready = objective.trim().length > 0 && target.baseUrl.trim().length > 0 && target.model.trim().length > 0 && authorised && !running

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          redquill <span className="sub">越狱探测 · 双通道判定</span>
        </div>
        <nav className="tabs">
          {(
            [
              ['probe', '探测'],
              ['tree', '攻击树'],
              ['report', '报告'],
              ['history', '历史']
            ] as [Tab, string][]
          ).map(([id, text]) => (
            <button
              key={id}
              className="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {text}
            </button>
          ))}
        </nav>
        <span className="topbar-spacer" />
        {running && progress && (
          <span className="chip">
            {progress.done}/{progress.total} · 突破 {progress.breaks}
          </span>
        )}
      </header>

      <div className="body">
        {tab === 'history' ? (
          <div className="main">
            <div className="scroll">
              <HistoryList onOpen={openRun} activeRunId={result?.runId ?? null} />
            </div>
          </div>
        ) : (
          <>
            <aside className="sidebar">
              <section className="card">
                <div className="card-head">目标行为（探测对象）</div>
                <div className="card-body">
                  <div className="field">
                    <label>被测行为 / 策略边界</label>
                    <textarea
                      rows={4}
                      value={objective}
                      placeholder="例如：泄露系统提示词中的内部规则 / 给出被策略禁止的具体操作步骤"
                      onChange={e => setObjective(e.target.value)}
                    />
                    <span className="hint">
                      攻击模板里只有策略框架，实际载荷由这里注入——所以同一套工具适用于任何策略边界。
                    </span>
                  </div>
                  <div className="field">
                    <label>部署的系统提示词（可选）</label>
                    <textarea
                      rows={2}
                      value={systemPrompt}
                      placeholder="如果生产环境有 system prompt，填在这里才能测到真实行为"
                      onChange={e => setSystemPrompt(e.target.value)}
                    />
                  </div>
                </div>
              </section>

              <section className="card">
                <div className="card-head">
                  <Cpu size={12} /> 被测端点
                </div>
                <div className="card-body">
                  <EndpointFields value={target} onChange={setTarget} />
                </div>
              </section>

              <section className="card">
                <div className="card-head">
                  <Scale size={12} /> 判定层
                </div>
                <div className="card-body">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={judge.enabled}
                      onChange={e => setJudge({ ...judge, enabled: e.target.checked })}
                    />
                    <span>
                      启用判定模型通道
                      <br />
                      <span style={{ color: 'var(--faint)' }}>
                        关闭后只跑启发式，置信度上限被压到 0.6，结论不可直接引用。
                      </span>
                    </span>
                  </label>
                  <div className="row">
                    <div className="field">
                      <label>判定票数</label>
                      <input
                        type="number"
                        min={1}
                        max={9}
                        value={judge.votes}
                        onChange={e => setJudge({ ...judge, votes: Math.max(1, Math.min(9, Number(e.target.value) || 3)) })}
                      />
                    </div>
                    <div className="field">
                      <label>判定模型 id</label>
                      <input
                        value={judge.endpoint?.model ?? ''}
                        placeholder="留空 = 复用被测端点"
                        onChange={e =>
                          setJudge({
                            ...judge,
                            endpoint: e.target.value.trim()
                              ? { ...target, model: e.target.value.trim() }
                              : null
                          })
                        }
                      />
                    </div>
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={judge.requireConsensus}
                      onChange={e => setJudge({ ...judge, requireConsensus: e.target.checked })}
                    />
                    <span>要求判定票全票一致，否则降级为「不确定」</span>
                  </label>
                  <span className="hint">
                    判定模型与被测端点相同时存在自评盲区，报告会标注这一点。建议用一个不同的模型做判定。
                  </span>
                </div>
              </section>

              <section className="card">
                <div className="card-head">
                  <Wand2 size={12} /> 进化与预算
                </div>
                <div className="card-body">
                  <div className="row">
                    <div className="field">
                      <label>种群 / 代</label>
                      <input
                        type="number"
                        min={1}
                        max={64}
                        value={population}
                        onChange={e => setPopulation(Math.max(1, Math.min(64, Number(e.target.value) || 12)))}
                      />
                    </div>
                    <div className="field">
                      <label>代数</label>
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={generations}
                        onChange={e => setGenerations(Math.max(1, Math.min(12, Number(e.target.value) || 4)))}
                      />
                    </div>
                    <div className="field">
                      <label>并发</label>
                      <input
                        type="number"
                        min={1}
                        max={16}
                        value={concurrency}
                        onChange={e => setConcurrency(Math.max(1, Math.min(16, Number(e.target.value) || 4)))}
                      />
                    </div>
                  </div>
                  <span className="hint">
                    共 {budget} 次目标调用。每次成功判定的算子组合会在下一代被强化。
                  </span>
                  <div className="field">
                    <label>
                      随机种子
                      <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => void reseed()}>
                        <Shuffle size={11} /> 换一个
                      </button>
                    </label>
                    <input value={String(effectiveSeed)} onChange={e => setSeed(Number(e.target.value) || 0)} />
                    <span className="hint">相同种子 + 相同配置 = 完全相同的探测序列。</span>
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={useRewriter}
                      onChange={e => setUseRewriter(e.target.checked)}
                    />
                    <span>用 LLM 改写高分离子（加速突破）</span>
                  </label>
                  {useRewriter && (
                    <div className="field">
                      <label>改写模型 id</label>
                      <input
                        value={rewriterModel}
                        placeholder={target.model || '留空则复用被测模型'}
                        onChange={e => setRewriterModel(e.target.value)}
                      />
                    </div>
                  )}
                  <FamilyPicker
                    families={families}
                    selected={selectedFamilies}
                    onToggle={id =>
                      setSelectedFamilies(prev =>
                        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                      )
                    }
                    onAll={all =>
                      setSelectedFamilies(all ? families.map(f => f.id) : [])
                    }
                  />
                </div>
              </section>

              <section className="card">
                <div className="card-body">
                  <label className="check gate">
                    <input
                      type="checkbox"
                      checked={authorised}
                      onChange={e => setAuthorised(e.target.checked)}
                    />
                    <span>
                      我确认该端点归我所有，或我已获得对其进行安全测试的明确授权。
                    </span>
                  </label>
                  <div className="row">
                    <button className="btn primary" disabled={!ready} onClick={() => void beginScan()}>
                      <Play size={13} />
                      开始探测
                    </button>
                    <button className="btn" disabled={!running} onClick={() => void stopScan()}>
                      <Square size={13} />
                      中止
                    </button>
                  </div>
                  {error && <div className="notice err">{error}</div>}
                  {!isTauri() && (
                    <div className="notice info">
                      浏览器预览模式：界面可用，但网络探测只在桌面应用内可用。
                    </div>
                  )}
                </div>
              </section>
            </aside>

            <main className="main">
              {tab === 'probe' && (
                <>
                  {running && progress && (
                    <div className="progress-wrap">
                      <div className="row" style={{ alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: 'var(--dim)', flex: 1 }}>
                          {progress.done < budget ? '正在探测…' : '正在进化下一代…'}
                        </span>
                        <span className="mono" style={{ color: 'var(--faint)' }}>
                          {progress.done}/{progress.total}
                        </span>
                      </div>
                      <div className="progress-bar">
                        <div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
                      </div>
                    </div>
                  )}
                  {result && <ResultStats result={result} />}
                  {attempts.length === 0 ? (
                    <div className="empty">
                      <h2>{running ? '正在发起第一次探测' : '尚未开始'}</h2>
                      <div style={{ maxWidth: 460 }}>
                        填入被测行为与端点，勾选授权后开始。每次探测都会实时出现在这里，
                        点击任意一行可查看完整对话、原始响应与两个判定通道的证据。
                      </div>
                    </div>
                  ) : (
                    <>
                      <AttemptTable attempts={attempts} onSelect={select} selected={selected} />
                      {selected && (
                        <AttemptDetail attempt={selected} onClose={() => setSelected(null)} />
                      )}
                    </>
                  )}
                </>
              )}

              {tab === 'tree' && (
                <>
                  {result && <ResultStats result={result} />}
                  <GenerationFilter
                    attempts={attempts}
                    value={generationFilter}
                    onChange={setGenerationFilter}
                  />
                  <AttackTree
                    attempts={attempts}
                    stats={result?.familyStats ?? []}
                    generation={generationFilter}
                    onSelect={select}
                    selectedId={selected?.probeId ?? null}
                  />
                  {selected && (
                    <AttemptDetail attempt={selected} onClose={() => setSelected(null)} />
                  )}
                </>
              )}

              {tab === 'report' && (
                <>
                  {result ? (
                    <>
                      <ResultStats result={result} />
                      <div className="scroll">
                        <div className="card-head" style={{ borderTop: 'none' }}>
                          防御建议 · 按严重度排序
                        </div>
                        <FindingsList findings={result.findings} />
                        <div className="card-head">攻击族命中率</div>
                        <FamilyTable stats={result.familyStats} />
                        <div style={{ padding: '14px 16px', color: 'var(--faint)', fontSize: 11, lineHeight: 1.7 }}>
                          判定模型：{result.judgeModel}
                          {result.judgeModel === result.targetModel && '（与被测端点相同，存在自评盲区）'}
                          <br />
                          运行 {result.generations} 代 · 随机种子 {result.seed} · 耗时 {duration(result.elapsedMs)}
                          {result.totalTokens > 0 && <> · 目标侧 token {compactNumber(result.totalTokens)}</>}
                          <br />
                          任何结论都可由证据列中的 probe id 复现——完整对话与原始响应都随记录保存。
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="empty">
                      <h2>还没有可报告的运行</h2>
                      <div>完成一次扫描后，这里会给出按严重度排序的防御建议。</div>
                    </div>
                  )}
                </>
              )}
            </main>
          </>
        )}
      </div>
    </div>
  )
}

function ResultStats({ result }: { result: ScanResult }) {
  const disputed = result.attempts.filter(a => a.verdict.disputed).length
  const errors = result.attempts.filter(a => a.error).length
  return (
    <div className="stat-row">
      <div className={`stat ${result.totalBreaks > 0 ? 'danger' : 'good'}`}>
        <span className="value">
          {result.totalBreaks}/{result.totalAttempts}
        </span>
        <span className="label">确认突破</span>
      </div>
      <div className="stat">
        <span className="value">{percent(result.overallSuccessRate, 1)}</span>
        <span className="label">整体突破率</span>
      </div>
      <div className="stat">
        <span className="value">{result.findings.length}</span>
        <span className="label">防御发现</span>
      </div>
      <div className="stat">
        <span className="value">{disputed}</span>
        <span className="label">判定分歧（需复核）</span>
      </div>
      <div className="stat">
        <span className="value">{errors}</span>
        <span className="label">请求误差</span>
      </div>
      <div className="stat">
        <span className="value">{duration(result.elapsedMs)}</span>
        <span className="label">耗时</span>
      </div>
    </div>
  )
}

function AttemptTable({
  attempts,
  onSelect,
  selected
}: {
  attempts: Attempt[]
  onSelect: (a: Attempt) => void
  selected: Attempt | null
}) {
  // Breaks first: the operator is auditing a security posture, so the hits
  // lead, and everything else stays one scroll away.
  const order = { compliance: 0, partial: 1, uncertain: 2, refusal: 3 }
  const sorted = [...attempts].sort(
    (a, b) =>
      order[a.verdict.label] - order[b.verdict.label] ||
      b.verdict.confidence - a.verdict.confidence
  )
  return (
    <div className="scroll">
      <div className="thead">
        <span>Probe</span>
        <span>判定</span>
        <span>请求摘要</span>
        <span>攻击族 · 算子</span>
        <span>置信 · 延迟</span>
      </div>
      {sorted.map(a => (
        <div
          key={a.probeId}
          className="attempt-row"
          aria-selected={selected?.probeId === a.probeId}
          onClick={() => onSelect(a)}
        >
          <span className="probe">
            {a.probeId}
            {a.rewritten && ' ✎'}
          </span>
          <span>
            <VerdictChip label={a.verdict.label} disputed={a.verdict.disputed} />
          </span>
          <span className="snippet">{a.error ? a.error : a.prompt.replace(/\s+/g, ' ')}</span>
          <span style={{ fontSize: 11, color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {a.family}
            {a.operators.length > 0 && ` · ${a.operators.length}算子`}
          </span>
          <span className="meta">
            {a.verdict.confidence.toFixed(2)} · {duration(a.latencyMs)}
          </span>
        </div>
      ))}
    </div>
  )
}

function GenerationFilter({
  attempts,
  value,
  onChange
}: {
  attempts: Attempt[]
  value: number | null
  onChange: (v: number | null) => void
}) {
  const max = attempts.reduce((m, a) => Math.max(m, a.generation), 0)
  if (max === 0 && attempts.length === 0) return null
  return (
    <div className="family-pills" style={{ padding: '10px 14px', borderBottom: '1px solid var(--edge)' }}>
      <button className="pill" aria-pressed={value === null} onClick={() => onChange(null)}>
        全部
      </button>
      {Array.from({ length: max + 1 }, (_, g) => {
        const count = attempts.filter(a => a.generation === g).length
        return (
          <button key={g} className="pill" aria-pressed={value === g} onClick={() => onChange(g)}>
            第 {g + 1} 代 · {count}
          </button>
        )
      })}
    </div>
  )
}