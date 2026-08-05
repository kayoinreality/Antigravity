import { useEffect, useRef, useState } from 'react'
import { NOTE_PALETTE, translate } from '@antigravity/core'
import { useStore } from '../state/store'
import { invalidateWrap } from '../canvas/renderer'

/**
 * Note editor.
 *
 * Edits are written through on every keystroke rather than on save. There is no
 * save button anywhere in the app, so a draft held in component state would be
 * a draft the user can lose by clicking the wrong thing.
 */
export function Editor() {
  const editingId = useStore((s) => s.editingId)
  const notes = useStore((s) => s.notes)
  const editNote = useStore((s) => s.editNote)
  const removeNote = useStore((s) => s.removeNote)
  const openEditor = useStore((s) => s.openEditor)
  const locale = useStore((s) => s.locale)

  const note = notes.find((n) => n.id === editingId)
  const titleRef = useRef<HTMLInputElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(Boolean(note))
    if (note) requestAnimationFrame(() => titleRef.current?.focus())
  }, [note?.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && editingId) openEditor(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editingId, openEditor])

  if (!note) return null

  const words = note.content.trim() ? note.content.trim().split(/\s+/).length : 0

  const update = (patch: { title?: string; content?: string; color?: string }) => {
    invalidateWrap(note.id)
    editNote(note.id, patch)
  }

  return (
    <>
      <div className="editor__backdrop" onClick={() => openEditor(null)} />
      <aside
        className={`editor ${visible ? 'editor--open' : ''}`}
        data-testid="editor"
        style={{ borderTopColor: note.color }}
      >
        <header className="editor__header">
          <button
            type="button"
            className="editor__delete"
            data-testid="editor-delete"
            onClick={() => removeNote(note.id)}
          >
            {translate(locale, 'editor.delete')}
          </button>
          <button
            type="button"
            className="editor__done"
            data-testid="editor-done"
            style={{ color: note.color }}
            onClick={() => openEditor(null)}
          >
            {translate(locale, 'editor.done')}
          </button>
        </header>

        <div className="editor__colors">
          {NOTE_PALETTE.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`editor__color ${note.color === entry.hex ? 'editor__color--on' : ''}`}
              style={{ background: entry.hex }}
              aria-label={entry.key}
              onClick={() => update({ color: entry.hex })}
            />
          ))}
        </div>

        <input
          ref={titleRef}
          className="editor__title"
          data-testid="editor-title"
          value={note.title}
          maxLength={120}
          placeholder={translate(locale, 'editor.title.placeholder')}
          onChange={(event) => update({ title: event.target.value })}
        />

        <textarea
          className="editor__body"
          data-testid="editor-body"
          value={note.content}
          placeholder={translate(locale, 'editor.body.placeholder')}
          onChange={(event) => update({ content: event.target.value })}
        />

        <footer className="editor__footer">
          <span>{translate(locale, 'editor.words', { count: words })}</span>
          <span>·</span>
          <span>{translate(locale, 'editor.chars', { count: note.content.length })}</span>
        </footer>
      </aside>
    </>
  )
}
