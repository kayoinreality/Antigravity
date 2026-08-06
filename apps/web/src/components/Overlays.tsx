import { useEffect, useState } from 'react'
import { translate } from '@antigravity/core'
import { useStore } from '../state/store'

/**
 * The small floating pieces of UI: the system suggestion, the undo toast, the
 * sync badge and the empty state.
 */

export function SuggestionPill() {
  const suggestion = useStore((s) => s.suggestion)
  const accept = useStore((s) => s.acceptSuggestion)
  const dismiss = useStore((s) => s.dismissSuggestion)
  const locale = useStore((s) => s.locale)

  if (!suggestion) return null

  return (
    <div className="pill" data-testid="suggestion">
      <span className="pill__star">☉</span>
      <span className="pill__text">
        {translate(locale, 'system.suggest', {
          count: suggestion.noteIds.length,
          label: suggestion.label,
        })}
      </span>
      <button type="button" className="pill__accept" data-testid="suggestion-accept" onClick={accept}>
        {translate(locale, 'system.accept')}
      </button>
      <button type="button" className="pill__dismiss" data-testid="suggestion-dismiss" onClick={dismiss}>
        {translate(locale, 'system.dismiss')}
      </button>
    </div>
  )
}

export function UndoToast() {
  const undo = useStore((s) => s.undo)
  const undoRemove = useStore((s) => s.undoRemove)
  const locale = useStore((s) => s.locale)
  const [, force] = useState(0)

  // The toast has a deadline, so it needs a tick to disappear on its own even
  // when nothing else in the app changes.
  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => force((n) => n + 1), Math.max(0, undo.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [undo])

  if (!undo || undo.expiresAt < Date.now()) return null

  return (
    <div className="toast" data-testid="undo-toast" role="status">
      <span>{translate(locale, 'blackhole.deleted')}</span>
      <button type="button" onClick={undoRemove} data-testid="undo-button">
        {translate(locale, 'blackhole.undo')}
      </button>
    </div>
  )
}

export function SyncBadge() {
  const status = useStore((s) => s.syncStatus)
  const locale = useStore((s) => s.locale)

  const label =
    status === 'disabled'
      ? translate(locale, 'sync.localOnly')
      : status === 'offline'
        ? translate(locale, 'sync.offline')
        : status === 'error'
          ? translate(locale, 'sync.error')
          : status === 'idle'
            ? translate(locale, 'sync.synced')
            : translate(locale, 'sync.syncing')

  return (
    <div className={`sync sync--${status}`} data-testid="sync-badge" title={label}>
      <span className="sync__dot" />
      <span className="sync__label">{label}</span>
    </div>
  )
}

export function EmptyState() {
  const notes = useStore((s) => s.notes)
  const ready = useStore((s) => s.ready)
  const locale = useStore((s) => s.locale)

  if (!ready || notes.length > 0) return null

  return (
    <div className="empty" data-testid="empty-state">
      <div className="empty__mark">✦</div>
      <h1>{translate(locale, 'canvas.empty.title')}</h1>
      <p>{translate(locale, 'canvas.empty.subtitle.web')}</p>
    </div>
  )
}

export function NoteCount() {
  const notes = useStore((s) => s.notes)
  const locale = useStore((s) => s.locale)

  return (
    <span className="count" data-testid="note-count">
      {notes.length === 1
        ? translate(locale, 'canvas.notes.one')
        : translate(locale, 'canvas.notes.many', { count: notes.length })}
    </span>
  )
}
