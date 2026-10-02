import { useEffect, useState } from 'react'
import { Trash2, Download } from 'lucide-react'
import type { RunSummary } from '../types'
import { deleteRun, errorMessage, exportRun, listRuns } from '../lib'
import { percent, timestamp } from '../format'

export function HistoryList({
  onOpen,
  activeRunId
}: {
  onOpen: (runId: string) => void
  activeRunId: string | null
}) {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [note, setNote] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null)

  async function refresh() {
    try {
      setRuns(await listRuns())
    } catch (e) {
      setNote({ kind: 'err', text: errorMessage(e) })
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function remove(runId: string, event: React.MouseEvent) {
    event.stopPropagation()
    try {
      await deleteRun(runId)
      await refresh()
    } catch (e) {
      setNote({ kind: 'err', text: errorMessage(e) })
    }
  }

  async function save(runId: string, event: React.MouseEvent) {
    event.stopPropagation()
    // Exports land next to the app's run store; the operator moves it from
    // there. A file dialog is avoided deliberately so the action cannot be
    // left half-completed.
    const destination = `${runId}.json`
    try {
      await exportRun(runId, destination)
      setNote({ kind: 'ok', text: `已导出到 ${destination}` })
    } catch (e) {
      setNote({ kind: 'err', text: errorMessage(e) })
    }
  }

  if (runs.length === 0) {
    return (
      <div className="empty">
        <h2>还没有历史运行</h2>
        <div>完成的扫描会自动存到本地，可随时重新打开。</div>
      </div>
    )
  }

  return (
    <div>
      {note && <div className={`notice ${note.kind}`} style={{ margin: 12 }}>{note.text}</div>}
      {runs.map(r => (
        <div
          className="history-row"
          key={r.runId}
          onClick={() => onOpen(r.runId)}
          style={
            activeRunId === r.runId
              ? { background: '#191d22' }
              : undefined
          }
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>{r.targetModel}</div>
            <div className="when">
              {timestamp(r.startedAt)} · seed {r.seed}
            </div>
          </div>
          <span className={`chip ${r.totalBreaks > 0 ? 'compliance' : 'refusal'}`}>
            <span className="glyph">{r.totalBreaks > 0 ? '✕' : '●'}</span>
            {r.totalBreaks}/{r.totalAttempts}
          </span>
          <span className="when" style={{ minWidth: 46, textAlign: 'right' }}>
            {percent(r.overallSuccessRate)}
          </span>
          <span style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              className="btn ghost sm"
              title="导出为 JSON 工件"
              onClick={e => void save(r.runId, e)}
            >
              <Download size={12} />
            </button>
            <button
              type="button"
              className="btn ghost sm"
              title="删除这条记录"
              onClick={e => void remove(r.runId, e)}
            >
              <Trash2 size={12} />
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}