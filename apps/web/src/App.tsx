import { useEffect } from 'react'
import { Canvas } from './canvas/Canvas'
import { SearchBar } from './components/SearchBar'
import { Editor } from './components/Editor'
import { EmptyState, NoteCount, SuggestionPill, SyncBadge, UndoToast } from './components/Overlays'
import { useStore } from './state/store'

export function App() {
  const init = useStore((s) => s.init)
  const ready = useStore((s) => s.ready)
  const addNote = useStore((s) => s.addNote)
  const editingId = useStore((s) => s.editingId)

  useEffect(() => {
    void init()
  }, [init])

  // `n` for a new note, but never while the user is typing into something.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'n' && !editingId) {
        event.preventDefault()
        // Placed at the middle of the viewport in world terms; the canvas
        // starts centred on the origin, so this lands where the user is looking.
        addNote(window.innerWidth / 2, window.innerHeight / 2)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addNote, editingId])

  return (
    <div className="app">
      <Canvas />

      <header className="topbar">
        <div className="brand">
          <span className="brand__name">antigravity</span>
          <NoteCount />
        </div>
        <SearchBar />
        <SyncBadge />
      </header>

      <EmptyState />
      <SuggestionPill />
      <UndoToast />
      <Editor />

      {!ready && <div className="booting" data-testid="booting" />}
    </div>
  )
}
