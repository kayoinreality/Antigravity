import { InteractionManager } from 'react-native'
import { getLocales } from 'expo-localization'
import { create } from 'zustand'
import {
  LexicalProvider,
  NOTE_HEIGHT,
  NOTE_WIDTH,
  SyncEngine,
  applyUpdate,
  createNote,
  createSystem,
  matchesFilters,
  normalizeBm25,
  parseQuery,
  pickColor,
  rankResults,
  resolveLocale,
  restore,
  softDelete,
  toSuggestions,
  type Filter,
  type Locale,
  type Note,
  type NoteLink,
  type NoteSystem,
  type SearchOutcome,
  type SyncStatus,
  type SystemSuggestion,
} from '@antigravity/core'
import { layoutSystem, systemBounds, type OrbitMember, type Rect } from '@antigravity/canvas-engine'
import { SQL_HANDLED_FILTERS, SqliteStore } from '../storage/sqlite-store'
import { evictPicture } from '../canvas/note-pictures'

/**
 * Application state.
 *
 * SQLite is the durable copy; this keeps the working set in memory because the
 * renderer needs every note's position each frame. Writes land in memory first
 * so the UI is immediate, then in the database, which is allowed to lag.
 */

const store = new SqliteStore()
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

  selectedId: string | null
  query: string
  search: SearchOutcome | null

  suggestion: SystemSuggestion | null
  dismissedSuggestions: Set<string>

  undo: UndoEntry | null
  syncStatus: SyncStatus
  locale: Locale
  focusBounds: Rect | null

  init: () => Promise<void>
  addNote: (worldX: number, worldY: number) => string
  editNote: (id: string, patch: { title?: string; content?: string; color?: string }) => void
  moveNote: (id: string, x: number, y: number) => void
  removeNote: (id: string) => void
  undoRemove: () => void
  select: (id: string | null) => void
  setQuery: (query: string) => Promise<void>
  acceptSuggestion: () => void
  dismissSuggestion: () => void
  detachFromSystem: (noteId: string) => void
  clearFocus: () => void
  refreshSuggestions: () => Promise<void>
}

/**
 * Clustering runs over the most recently touched notes rather than the whole
 * canvas.
 *
 * Measured on the seed harness: 500 notes take ~160ms, 1,500 take ~640ms,
 * 3,000 take ~2.1s and 6,000 take ~9.9s — the cost is superlinear, and this
 * runs as a background task that still blocks the thread it is on. 1,500 is
 * the largest slice that stays under a second.
 *
 * It is also the right scope on its own terms: a suggestion is about the notes
 * you have been working on, not about something you wrote two years ago.
 */
const CLUSTER_INPUT_CAP = 1500

let syncEngine: SyncEngine | null = null
let clusterTimer: ReturnType<typeof setTimeout> | null = null
/** Guards against an older search resolving after a newer one. */
let searchToken = 0

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  notes: [],
  systems: [],
  links: [],

  selectedId: null,
  query: '',
  search: null,

  suggestion: null,
  dismissedSuggestions: new Set(),

  undo: null,
  syncStatus: 'disabled',
  locale: resolveLocale(getLocales()[0]?.languageTag),
  focusBounds: null,

  async init() {
    await store.init()

    const [notes, systems, links] = await Promise.all([
      store.listNotes(),
      store.listSystems(),
      store.listLinks(),
    ])

    set({ notes, systems, links, ready: true })

    const { createSupabaseClient, SupabaseAdapter } = await import('@antigravity/supabase-client')
    const client = createSupabaseClient({
      url: process.env.EXPO_PUBLIC_SUPABASE_URL,
      anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      // No URL bar on native, so there is no OAuth callback to read out of one.
      detectSessionInUrl: false,
    })

    syncEngine = new SyncEngine({
      store,
      remote: client ? new SupabaseAdapter({ client }) : null,
      onStatusChange: (syncStatus) => set({ syncStatus }),
      onApplied: () => void reload(set),
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

    set((state) => ({ notes: [...state.notes, note], selectedId: note.id }))
    void store.putNotes([note])
    scheduleClustering(get)
    return note.id
  },

  editNote(id, patch) {
    const current = get().notes.find((n) => n.id === id)
    if (!current) return

    const updated = applyUpdate(current, patch)
    // The cached Skia picture was recorded from the old text.
    evictPicture(id)

    set((state) => ({ notes: state.notes.map((n) => (n.id === id ? updated : n)) }))
    void store.putNotes([updated])
    void get().setQuery(get().query)
    scheduleClustering(get)
  },

  moveNote(id, x, y) {
    const current = get().notes.find((n) => n.id === id)
    if (!current) return

    const updated = applyUpdate(current, { x, y })
    set((state) => ({ notes: state.notes.map((n) => (n.id === id ? updated : n)) }))
    // One row, two columns — not a re-serialization of the whole collection.
    void store.moveNote(id, x, y, updated.updatedAt)
  },

  removeNote(id) {
    const current = get().notes.find((n) => n.id === id)
    if (!current) return

    evictPicture(id)
    set((state) => ({
      notes: state.notes.filter((n) => n.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
      // Keep the whole note, not just its id: by the time the user reaches for
      // undo, the row in SQLite is a tombstone.
      undo: { note: current, expiresAt: Date.now() + 6000 },
    }))

    void store.putNotes([softDelete(current)])
    void get().setQuery(get().query)
    scheduleClustering(get)
  },

  undoRemove() {
    const entry = get().undo
    if (!entry) return

    const revived = restore(entry.note)
    set((state) => ({ notes: [...state.notes, revived], undo: null, selectedId: revived.id }))
    void store.putNotes([revived])
    scheduleClustering(get)
  },

  select(id) {
    set({ selectedId: id })
  },

  /**
   * Search: parse in shared core, resolve text in SQL, apply the rest in shared
   * core, rank in shared core. The split exists because FTS5 and the indexed
   * columns are much faster than a JS scan, while the predicates SQL cannot
   * express cheaply stay in the one implementation both platforms use.
   */
  async setQuery(query) {
    set({ query })

    if (!query.trim()) {
      set({ search: null })
      return
    }

    const token = ++searchToken
    const { notes, links, systems, locale } = get()
    const parsed = parseQuery(query, { locale })

    if (parsed.isEmpty) {
      set({ search: null })
      return
    }

    const textScores = parsed.text ? await store.searchText(parsed.text) : null
    if (token !== searchToken) return // a newer keystroke already superseded this

    const linkCounts = new Map<string, number>()
    for (const link of links) {
      if (link.deletedAt !== null) continue
      linkCounts.set(link.fromId, (linkCounts.get(link.fromId) ?? 0) + 1)
      linkCounts.set(link.toId, (linkCounts.get(link.toId) ?? 0) + 1)
    }
    const systemLabels = new Map(systems.map((s) => [s.id, s.label]))

    // Every filter is evaluated here rather than pushed into SQL. The set of
    // candidates is already small by this point, and one implementation of
    // "sem link" is worth more than the microseconds a second one would save.
    void SQL_HANDLED_FILTERS
    const remaining: Filter[] = parsed.filters

    const candidates = notes.filter((note) => {
      if (textScores && !textScores.has(note.id)) return false
      return matchesFilters(note, remaining, {
        linkCount: (id) => linkCounts.get(id) ?? 0,
        systemLabel: (id) => systemLabels.get(id) ?? null,
      })
    })

    const results = rankResults(
      candidates.map((note) => ({
        noteId: note.id,
        textScore: normalizeBm25(textScores?.get(note.id) ?? 0),
        updatedAt: note.updatedAt,
        pinned: note.pinned,
        inActiveSystem: false,
      })),
      { hasTextQuery: parsed.text.length > 0 },
    )

    set({ search: { parsed, results, matched: new Set(results.map((r) => r.noteId)) } })
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

    const moved = slots.map((slot) =>
      applyUpdate(byId.get(slot.noteId)!, {
        x: slot.x,
        y: slot.y,
        systemId: system.id,
        orbitRadius: slot.radius,
        orbitAngle: slot.angle,
      }),
    )

    const movedById = new Map(moved.map((n) => [n.id, n]))
    set((state) => ({
      systems: [...state.systems, system],
      notes: state.notes.map((n) => movedById.get(n.id) ?? n),
      suggestion: null,
      focusBounds: systemBounds(slots, NOTE_WIDTH, NOTE_HEIGHT),
    }))

    void store.putSystems([system])
    void store.putNotes(moved)
  },

  dismissSuggestion() {
    const suggestion = get().suggestion
    if (!suggestion) return
    set((state) => ({
      suggestion: null,
      dismissedSuggestions: new Set([...state.dismissedSuggestions, suggestion.key]),
    }))
  },

  detachFromSystem(noteId) {
    const note = get().notes.find((n) => n.id === noteId)
    if (!note?.systemId) return

    const detached = applyUpdate(note, { systemId: null, orbitRadius: null, orbitAngle: null })
    set((state) => ({ notes: state.notes.map((n) => (n.id === noteId ? detached : n)) }))
    void store.putNotes([detached])
  },

  clearFocus() {
    set({ focusBounds: null })
  },

  async refreshSuggestions() {
    const { notes, dismissedSuggestions } = get()

    const recent = [...notes]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, CLUSTER_INPUT_CAP)

    const clusters = await clusterProvider.cluster(recent)
    set({ suggestion: toSuggestions(clusters, recent, { dismissed: dismissedSuggestions })[0] ?? null })
  },
}))

type SetState = (partial: Partial<AppState>) => void

async function reload(set: SetState): Promise<void> {
  const [notes, systems, links] = await Promise.all([
    store.listNotes(),
    store.listSystems(),
    store.listLinks(),
  ])
  set({ notes, systems, links })
}

/**
 * Clustering is O(n^2) over the whole canvas. It waits for a lull, then for the
 * gestures to finish, so a suggestion nobody asked for yet never costs a frame
 * during a pan.
 */
function scheduleClustering(get: () => AppState): void {
  if (clusterTimer) clearTimeout(clusterTimer)
  clusterTimer = setTimeout(() => {
    clusterTimer = null
    InteractionManager.runAfterInteractions(() => void get().refreshSuggestions())
  }, 1200)
}

export const getSyncEngine = (): SyncEngine | null => syncEngine
export const getLocalStore = (): SqliteStore => store
