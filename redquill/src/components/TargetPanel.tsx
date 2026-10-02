import { useEffect, useState } from 'react'
import { Plug, RefreshCw } from 'lucide-react'
import type { Endpoint, FamilyInfo } from '../types'
import { errorMessage, listModels, testEndpoint } from '../lib'

export function EndpointFields({
  value,
  onChange,
  testLabel = '测试连通'
}: {
  value: Endpoint
  onChange: (next: Endpoint) => void
  testLabel?: string
}) {
  const [models, setModels] = useState<string[]>([])
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const patch = (partial: Partial<Endpoint>) => onChange({ ...value, ...partial })

  useEffect(() => {
    setStatus(null)
  }, [value.baseUrl, value.model])

  async function probe() {
    setBusy(true)
    setStatus(null)
    try {
      const text = await testEndpoint(value)
      setStatus({ kind: 'ok', text: `连通 · ${text}` })
    } catch (e) {
      setStatus({ kind: 'err', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  async function fetchModels() {
    setBusy(true)
    setStatus(null)
    try {
      const found = await listModels({ ...value, model: '' })
      setModels(found)
      // Servers without `/models` return an empty list rather than failing;
      // say so instead of leaving the operator wondering.
      setStatus(
        found.length
          ? { kind: 'ok', text: `发现 ${found.length} 个模型` }
          : { kind: 'info', text: '该端点未提供模型列表，请手动填写模型 id' }
      )
    } catch (e) {
      setModels([])
      setStatus({ kind: 'err', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="field">
        <label>Base URL（OpenAI 兼容）</label>
        <input
          value={value.baseUrl}
          placeholder="http://localhost:11434/v1"
          onChange={e => patch({ baseUrl: e.target.value })}
        />
      </div>
      <div className="field">
        <label>
          模型 id
          <button
            type="button"
            className="btn ghost sm"
            onClick={fetchModels}
            disabled={busy || !value.baseUrl}
          >
            <RefreshCw size={12} />
            拉取列表
          </button>
        </label>
        <input
          value={value.model}
          placeholder="qwen2.5:7b"
          list="rq-models"
          onChange={e => patch({ model: e.target.value })}
        />
        {models.length > 0 && (
          <datalist id="rq-models">
            {models.map(m => (
              <option key={m} value={m} />
            ))}
          </datalist>
        )}
      </div>
      <div className="field">
        <label>API Key（本地端点可留空）</label>
        <input
          type="password"
          value={value.apiKey}
          placeholder="sk-…"
          onChange={e => patch({ apiKey: e.target.value })}
        />
      </div>
      <div className="row">
        <div className="field">
          <label>Temperature</label>
          <input
            type="number"
            step="0.1"
            value={value.temperature ?? ''}
            placeholder="继承部署默认"
            onChange={e => patch({ temperature: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>超时（秒）</label>
          <input
            type="number"
            min={5}
            value={value.timeoutSecs}
            onChange={e => patch({ timeoutSecs: Math.max(5, Number(e.target.value) || 60) })}
          />
        </div>
      </div>
      <button type="button" className="btn sm" onClick={probe} disabled={busy || !value.baseUrl}>
        <Plug size={12} />
        {testLabel}
      </button>
      {status && <div className={`notice ${status.kind}`}>{status.text}</div>}
    </>
  )
}

export function FamilyPicker({
  families,
  selected,
  onToggle,
  onAll
}: {
  families: FamilyInfo[]
  selected: string[]
  onToggle: (id: string) => void
  onAll: (selectAll: boolean) => void
}) {
  return (
    <div className="field">
      <label>
        攻击族
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" className="btn ghost sm" onClick={() => onAll(true)}>
            全选
          </button>
          <button type="button" className="btn ghost sm" onClick={() => onAll(false)}>
            清空
          </button>
        </span>
      </label>
      <div className="family-pills">
        {families.map(f => (
          <button
            key={f.id}
            type="button"
            className="pill"
            aria-pressed={selected.includes(f.id)}
            title={f.summary}
            onClick={() => onToggle(f.id)}
          >
            {f.name}
            {f.multiTurn ? ' ⋯' : ''}
          </button>
        ))}
      </div>
      <span className="hint">
        留空则使用全部 {families.length} 个攻击族。每代至少各投一发裸请求作为基线对照。
      </span>
    </div>
  )
}