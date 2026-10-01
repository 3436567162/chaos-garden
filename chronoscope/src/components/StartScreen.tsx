import type { ScanProgress } from '../types'

const PHASE_LABEL: Record<ScanProgress['phase'], string> = {
  commits: '读取提交历史',
  trees: '统计文件行数',
  saving: '写入缓存'
}

export interface Props {
  progress: ScanProgress | null
  /** Repo currently being scanned, for the caption. */
  path: string
  error: string | null
  onOpen: () => void
  onDemo: () => void
  onDismiss: () => void
}

/** Shown before a repository is chosen, and while one is being scanned. */
export function StartScreen({ progress, path, error, onOpen, onDemo, onDismiss }: Props) {
  const busy = progress !== null
  const pct =
    busy && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : busy && progress.phase === 'commits'
        ? null
        : busy
          ? 100
          : null

  return (
    <div className="start" role="dialog" aria-label="选择仓库">
      <div className="start-card glass">
        <div className="brand">chronoscope</div>
        <h1>把一个 Git 仓库变成一座城市</h1>
        <p className="start-lede">
          完全离线。直接读取本地 <code>.git</code>，不联网、不上传、不需要账号。
        </p>

        {error ? (
          <div className="start-error" role="alert">
            {error}
          </div>
        ) : null}

        {busy ? (
          <div className="start-progress">
            <div className="start-phase">
              <span>{PHASE_LABEL[progress.phase]}</span>
              <span className="mono">
                {pct === null ? '' : `${pct}%`}
                {progress.total > 0 && progress.phase === 'trees'
                  ? ` ${progress.done}/${progress.total}`
                  : ''}
              </span>
            </div>
            {pct === null ? (
              <div className="bar">
                <i />
              </div>
            ) : (
              <div className="bar">
                <i style={{ width: `${pct}%` }} />
              </div>
            )}
            <div className="start-path mono" title={path}>
              {path}
            </div>
          </div>
        ) : (
          <div className="start-actions">
            <button type="button" className="btn-primary" onClick={onOpen}>
              打开本地仓库
            </button>
            <button type="button" className="btn-ghost" onClick={onDemo}>
              看演示数据
            </button>
          </div>
        )}

        {!busy && error ? (
          <button type="button" className="start-dismiss" onClick={onDismiss}>
            知道了
          </button>
        ) : null}
      </div>
    </div>
  )
}