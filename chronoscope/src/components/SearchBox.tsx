import { useEffect, useRef, useState } from 'react'
import type { History } from '../history'
import { fmtInt } from '../format'

interface Props {
  history: History
  /** Jumps the playhead to a sample. */
  onPick: (row: number) => void
}

/** Jumps between commits whose message or author matches the query. */
export function SearchBox({ history, onPick }: Props) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = query.trim() ? history.search(query) : []

  // A new query resets the cursor; an emptied query clears the highlight.
  useEffect(() => {
    setCursor(0)
  }, [query])

  // `/` focuses the field, the way most tools behave.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.repeat) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select')) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const goto = (next: number) => {
    if (matches.length === 0) return
    // Wrap, so repeated Enter cycles forever.
    const wrapped = (next + matches.length) % matches.length
    setCursor(wrapped)
    onPick(matches[wrapped])
  }

  return (
    <div className="searchbox">
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="搜索 commit / 按 /"
        aria-label="搜索提交"
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            goto(cursor + (e.shiftKey ? -1 : 1))
          } else if (e.key === 'Escape') {
            setQuery('')
            inputRef.current?.blur()
          }
          e.stopPropagation()
        }}
      />
      {query.trim() ? (
        <span className="searchbox-count mono">
          {matches.length === 0 ? '无匹配' : `${cursor + 1}/${fmtInt(matches.length)}`}
        </span>
      ) : null}
    </div>
  )
}