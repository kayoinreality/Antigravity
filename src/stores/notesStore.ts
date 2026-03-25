import { createMMKV } from 'react-native-mmkv'
import { create } from 'zustand'
import type { Note, NoteColor } from '../types/note'
import { NOTE_COLORS } from '../types/note'

const storage = createMMKV({ id: 'antigravity-v1' })

const generateId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`

const loadNotes = (): Note[] => {
  try {
    const raw = storage.getString('notes')
    if (!raw) return []
    return JSON.parse(raw) as Note[]
  } catch {
    return []
  }
}

const persist = (notes: Note[]): void => {
  try {
    storage.set('notes', JSON.stringify(notes))
  } catch (e) {
    console.warn('[NotesStore] persist failed:', e)
  }
}

let colorIndex = 0

const nextColor = (): NoteColor => {
  const color = NOTE_COLORS[colorIndex % NOTE_COLORS.length]
  colorIndex++
  return color
}

export interface NotesState {
  notes: Note[]
  selectedNoteId: string | null
  editingNoteId: string | null
  connectMode: boolean
  connectSourceId: string | null

  addNote: (x: number, y: number) => string
  updateNote: (id: string, updates: Partial<Pick<Note, 'title' | 'content' | 'color'>>) => void
  moveNote: (id: string, x: number, y: number) => void
  deleteNote: (id: string) => void
  selectNote: (id: string | null) => void
  startEditing: (id: string) => void
  stopEditing: () => void
  enterConnectMode: (sourceId: string) => void
  exitConnectMode: () => void
  toggleConnection: (fromId: string, toId: string) => void
  clearAll: () => void
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: loadNotes(),
  selectedNoteId: null,
  editingNoteId: null,
  connectMode: false,
  connectSourceId: null,

  addNote: (x, y) => {
    const id = generateId()
    const note: Note = {
      id,
      title: '',
      content: '',
      x,
      y,
      color: nextColor(),
      connections: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const notes = [...get().notes, note]
    set({ notes, selectedNoteId: id })
    persist(notes)
    return id
  },

  updateNote: (id, updates) => {
    const notes = get().notes.map((n) =>
      n.id === id ? { ...n, ...updates, updatedAt: Date.now() } : n
    )
    set({ notes })
    persist(notes)
  },

  moveNote: (id, x, y) => {
    const notes = get().notes.map((n) =>
      n.id === id ? { ...n, x, y } : n
    )
    set({ notes })
    persist(notes)
  },

  deleteNote: (id) => {
    const notes = get()
      .notes.filter((n) => n.id !== id)
      .map((n) => ({
        ...n,
        connections: n.connections.filter((cid) => cid !== id),
      }))
    set({ notes, selectedNoteId: null, editingNoteId: null })
    persist(notes)
  },

  selectNote: (id) => set({ selectedNoteId: id }),
  startEditing: (id) => set({ editingNoteId: id, selectedNoteId: id }),
  stopEditing: () => set({ editingNoteId: null }),

  enterConnectMode: (sourceId) =>
    set({ connectMode: true, connectSourceId: sourceId }),

  exitConnectMode: () =>
    set({ connectMode: false, connectSourceId: null }),

  toggleConnection: (fromId, toId) => {
    if (fromId === toId) {
      set({ connectMode: false, connectSourceId: null })
      return
    }
    const notes = get().notes.map((n) => {
      if (n.id === fromId) {
        const exists = n.connections.includes(toId)
        return {
          ...n,
          connections: exists
            ? n.connections.filter((id) => id !== toId)
            : [...n.connections, toId],
        }
      }
      return n
    })
    set({ notes, connectMode: false, connectSourceId: null })
    persist(notes)
  },

  clearAll: () => {
    storage.remove('notes')
    set({ notes: [], selectedNoteId: null, editingNoteId: null })
  },
}))