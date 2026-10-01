export const SPEEDS = [0.5, 1, 2, 4] as const
export type Speed = (typeof SPEEDS)[number]

/** Time each commit stays on screen during autoplay at 1×. */
export const BASE_STEP_MS = 900

interface Props {
  playing: boolean
  speed: Speed
  onToggle: () => void
  onSpeed: (speed: Speed) => void
}

export function Playback({ playing, speed, onToggle, onSpeed }: Props) {
  return (
    <div className="playback">
      <button
        type="button"
        className="play-btn"
        onClick={onToggle}
        aria-label={playing ? '暂停' : '播放'}
        title={playing ? '暂停 (空格)' : '播放 (空格)'}
      >
        {playing ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3.5" y="2.5" width="3" height="11" rx="1" />
            <rect x="9.5" y="2.5" width="3" height="11" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4.5 2.8v10.4a.8.8 0 0 0 1.2.7l8.4-5.2a.8.8 0 0 0 0-1.4L5.7 2.1a.8.8 0 0 0-1.2.7z" />
          </svg>
        )}
      </button>
      <div className="speed" role="group" aria-label="播放速度">
        {SPEEDS.map(s => (
          <button
            key={s}
            type="button"
            className={s === speed ? 'speed-btn active' : 'speed-btn'}
            aria-pressed={s === speed}
            onClick={() => onSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  )
}
