import { create } from 'zustand'
import {
  LexicalProvider,
  NOTE_HEIGHT,
  NOTE_WIDTH,
  SyncEngine,
  TextIndex,
  applyUpdate,
  createLink,
  createNote,
  createSystem,
  extractTags,
  pickColor,
  restore,
  searchNotes,
  softDelete,
  toSuggestions,
  type Locale,
  type Note,
  type NoteLink,
  type NoteSystem,
  type SearchOutcome,
  type SyncStatus,
  type SystemSuggestion,
} from '@antigravity/core'
import { layoutSystem, systemBounds, type OrbitMember, type Rect } from '@antigravity/canvas-engine'
import { IdbStore } from '../storage/idb-store'

/**
 * Application state.
 *
 * The IndexedDB store is the durable copy; this holds the working set in memory
 * because the canvas needs every note's position on every frame and a round
 * trip to IDB per frame is not viable. Writes go to both: memory first so the
 * UI is immediate, then persistence, which is allowed to lag.
 */

const store = new IdbStore()
const clusterProvider = new LexicalProvider()

export interface UndoEntry {
  note: Note
  expiresAt: number
}

interface AppState {
  ready: boolean
  notes: Note[]
  systems: NoteSystem[]
  links: NoteLink[]
  index: TextIndex

  selectedId: string | null
  editingId: string | null

  query: string
  search: SearchOutcome | null

  suggestion: SystemSuggestion | null
  dismissedSuggestions: Set<string>

  undo: UndoEntry | null
  syncStatus: SyncStatus
  locale: Locale
  /** A world rect the canvas should frame on its next frame, then clear. */
  focusBounds: Rect | null

  init: () => Promise<void>
  addNote: (worldX: number, worldY: number) => string
  editNote: (id: string, patch: { title?: string; content?: string; color?: string }) => void
  moveNote: (id: string, x: number, y: number) => void
  removeNote: (id: string) => void
  undoRemove: () => void
  select: (id: string | null) => void
  openEditor: (id: string | null) => void
  toggleLink: (fromId: string, toId: string) => void
  setQuery: (query: string) => void
  acceptSuggestion: () => void
  dismissSuggestion: () => void
  dissolveSystem: (systemId: string) => void
  clearFocus: () => void
  detachFromSystem: (noteId: string) => void
  refreshSuggestions: () => Promise<void>
}

let syncEngine: SyncEngine | null = null
/** Coalesces clustering runs; it is O(n^2) and must not chase every keystroke. */
let clusterTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  notes: [],
  systems: [],
  links: [],
  index: new TextIndex(),

  selectedId: null,
  editingId: null,

  query: '',
  search: null,

  suggestion: null,
  dismissedSuggestions: new Set(),

  undo: null,
  syncStatus: 'disabled',
  focusBounds: null,
  locale: (navigator.language ?? 'pt').toLowerCase().startsWith('pt') ? 'pt' : 'en',

  async init() {
    await store.init()

    const [notes, systems, links] = await Promise.all([
      store.listNotes(),
      store.listSystems(),
      store.listLinks(),
    ])

    const index = new TextIndex()
    for (const note of notes) {
      index.add({ id: note.id, title: note.title, content: note.content, tags: extractTags(note) })
    }

    set({ notes, systems, links, index, ready: true })

    const { createSupabaseClient, SupabaseAdapter } = await import('@antigravity/supabase-client')
    const client = createSupabaseClient({
      url: import.meta.env.VITE_SUPABASE_URL,
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    })

    syncEngine = new SyncEngine({
      store,
      remote: client ? new SupabaseAdapter({ client }) : null,
      onStatusChange: (syncStatus) => set({ syncStatus }),
      onApplied: () => {
        // A pull can land anything: new notes, edits, deletions from another
        // device. Reload wholesale rather than trying to patch — at this size
        // it is cheaper than being clever, and it cannot go subtly wrong.
        void reloadFromStore(set)
      },
    })
    syncEngine.start()

    void get().refreshSuggestions()
  },

  addNote(worldX, worldY) {
    const note = createNote({
      x: worldX - NOTE_WIDTH / 2,
      y: worldY - NOTE_HEIGHT / 2,
      color: pickColor(get().notes.length),
    })

    set((state) => ({ notes: [...state.notes, note], selectedId: note.id, editingId: note.id }))
    void store.putNotes([note])
    scheduleClustering(get)
    return note.id
  },

  editNote(id, patch) {
    const current = get().notes.find((n) => n.id === id)
    if (!current) return

    const updated = applyUpdate(current, patch)
    get().index.add({
      id: updated.id,
      title: updated.title,
      content: updated.content,
      tags: extractTags(updated),
    })

    set((state) => ({ notes: state.notes.map((n) => (n.id === id ? updated : n)) }))
    void store.putNotes([updated])
    rerunSearch(set, get)
    scheduleClustering(get)
  },

  moveNote(id, x, y) {
    const current = get().notes.find((n) => n.id === id)
    if (!current) return

    const updated = applyUpdate(current, { x, y })
    set((state) => ({ notes: state.notes.map((n) => (n.id === id ? updated : n)) }))
    void store.putNotes([updated])
  },

  removeNote(id) {
    const current = get().notes.find((n) => n.id === id)
    if (!current) return

    const tombstoned = softDelete(current)
    get().index.remove(id)

    set((state) => ({
      notes: state.notes.filter((n) => n.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
      editingId: state.editingId === id ? null : state.editingId,
      // The note is kept whole in the undo slot, not just its id: by the time
      // the user hits restore, the row in IDB is a tombstone.
      undo: { note: current, expiresAt: Date.now() + 6000 },
    }))

    void store.putNotes([tombstoned])
    rerunSearch(set, get)
    scheduleClustering(get)
  },

  undoRemove() {
    const entry = get().undo
    if (!entry) return

    const revived = restore(entry.note)
    get().index.add({
      id: revived.id,
      title: revived.title,
      content: revived.content,
      tags: extractTags(revived),
    })

    set((state) => ({ notes: [...state.notes, revived], undo: null, selectedId: revived.id }))
    void store.putNotes([revived])
    scheduleClustering(get)
  },

  select(id) {
    set({ selectedId: id })
  },

  openEditor(id) {
    set({ editingId: id, ...(id ? { selectedId: id } : {}) })
  },

  toggleLink(fromId, toId) {
    const existing = get().links.find(
      (l) =>
        l.deletedAt === null &&
        ((l.fromId === fromId && l.toId === toId) || (l.fromId === toId && l.toId === fromId)),
    )

    if (existing) {
      const removed = { ...existing, deletedAt: Date.now(), updatedAt: Date.now(), dirty: true }
      set((state) => ({ links: state.links.filter((l) => l.id !== existing.id) }))
      void store.putLinks([removed])
      return
    }

    const link = createLink(fromId, toId)
    set((state) => ({ links: [...state.links, link] }))
    void store.putLinks([link])
  },

  setQuery(query) {
    set({ query })
    rerunSearch(set, get)
  },

  acceptSuggestion() {
    const suggestion = get().suggestion
    if (!suggestion) return

    const system = createSystem(
      suggestion.label,
      suggestion.terms,
      suggestion.centroidX,
      suggestion.centroidY,
    )
    system.acceptedAt = Date.now()

    const byId = new Map(get().notes.map((n) => [n.id, n]))
    const members: OrbitMember[] = suggestion.noteIds.flatMap((id) => {
      const note = byId.get(id)
      return note ? [{ noteId: id, affinity: suggestion.confidence, createdAt: note.createdAt }] : []
    })

    const slots = layoutSystem(members, suggestion.centroidX, suggestion.centroidY, {
      noteWidth: NOTE_WIDTH,
      noteHeight: NOTE_HEIGHT,
    })

    const moved = slots.map((slot) => {
      const note = byId.get(slot.noteId)!
      return applyUpdate(note, {
        x: slot.x,
        y: slot.y,
        systemId: system.id,
        orbitRadius: slot.radius,
        orbitAngle: slot.angle,
      })
    })

    const movedById = new Map(moved.map((n) => [n.id, n]))
    const bounds = systemBounds(slots, NOTE_WIDTH, NOTE_HEIGHT)

    set((state) => ({
      systems: [...state.systems, system],
      notes: state.notes.map((n) => movedById.get(n.id) ?? n),
      suggestion: null,
      // The cluster sits wherever its notes were, which is usually not where
      // the camera is pointing. Ask the canvas to go and look at it.
      focusBounds: bounds,
    }))

    void store.putSystems([system])
    void store.putNotes(moved)
  },

  clearFocus() {
    set({ focusBounds: null })
  },

  dismissSuggestion() {
    const suggestion = get().suggestion
    if (!suggestion) return
    set((state) => ({
      suggestion: null,
      dismissedSuggestions: new Set([...state.dismissedSuggestions, suggestion.key]),
    }))
  },

  dissolveSystem(systemId) {
    const system = get().systems.find((s) => s.id === systemId)
    if (!system) return

    const released = get()
      .notes.filter((n) => n.systemId === systemId)
      .map((n) => applyUpdate(n, { systemId: null, orbitRadius: null, orbitAngle: null }))

    const releasedById = new Map(released.map((n) => [n.id, n]))
    const tombstoned = { ...system, deletedAt: Date.now(), updatedAt: Date.now(), dirty: true }

    set((state) => ({
      systems: state.systems.filter((s) => s.id !== systemId),
      notes: state.notes.map((n) => releasedById.get(n.id) ?? n),
    }))

    void store.putSystems([tombstoned])
    void store.putNotes(released)
  },

  detachFromSystem(noteId) {
    const note = get().notes.find((n) => n.id === noteId)
    if (!note?.systemId) return

    const detached = applyUpdate(note, { systemId: null, orbitRadius: null, orbitAngle: null })
    set((state) => ({ notes: state.notes.map((n) => (n.id === noteId ? detached : n)) }))
    void store.putNotes([detached])
  },

  async refreshSuggestions() {
    const { notes, dismissedSuggestions } = get()
    const clusters = await clusterProvider.cluster(notes)
    const suggestions = toSuggestions(clusters, notes, { dismissed: dismissedSuggestions })
    set({ suggestion: suggestions[0] ?? null })
  },
}))

type SetState = (partial: Partial<AppState>) => void

async function reloadFromStore(set: SetState): Promise<void> {
  const [notes, systems, links] = await Promise.all([
    store.listNotes(),
    store.listSystems(),
    store.listLinks(),
  ])

  const index = new TextIndex()
  for (const note of notes) {
    index.add({ id: note.id, title: note.title, content: note.content, tags: extractTags(note) })
  }

  set({ notes, systems, links, index })
}

function rerunSearch(set: SetState, get: () => AppState): void {
  const { query, notes, index, links, systems } = get()

  if (!query.trim()) {
    set({ search: null })
    return
  }

  const linkCounts = new Map<string, number>()
  for (const link of links) {
    if (link.deletedAt !== null) continue
    linkCounts.set(link.fromId, (linkCounts.get(link.fromId) ?? 0) + 1)
    linkCounts.set(link.toId, (linkCounts.get(link.toId) ?? 0) + 1)
  }

  const systemLabels = new Map(systems.map((s) => [s.id, s.label]))

  set({
    search: searchNotes({
      query,
      notes,
      index,
      locale: get().locale,
      context: {
        linkCount: (id) => linkCounts.get(id) ?? 0,
        systemLabel: (id) => systemLabels.get(id) ?? null,
      },
    }),
  })
}

/**
 * Clustering is O(n^2) over the whole canvas, so it waits for a lull and then
 * runs when the browser is idle. Running it per edit would make typing stutter
 * on a large canvas for a suggestion nobody asked for yet.
 */
function scheduleClustering(get: () => AppState): void {
  if (clusterTimer) clearTimeout(clusterTimer)

  clusterTimer = setTimeout(() => {
    clusterTimer = null
    const run = () => void get().refreshSuggestions()

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 2000 })
    } else {
      run()
    }
  }, 1200)
}

export const getSyncEngine = (): SyncEngine | null => syncEngine
export const getLocalStore = (): IdbStore => store
