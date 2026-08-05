import type { Note, NoteLink, NoteSystem } from '../model/types'

/**
 * What a platform must provide to back the canvas.
 *
 * Mobile implements this over SQLite (with FTS5 for text), web over IndexedDB
 * plus the in-memory `TextIndex`. Everything above this interface — the sync
 * engine, the clustering scheduler, the UI stores — is written once against it.
 *
 * Deleted rows stay readable: sync needs tombstones and undo needs the body
 * back. `listNotes()` therefore returns live notes only, and callers that need
 * the graveyard ask for it explicitly.
 */

export interface SyncMeta {
  /** Server clock of the newest row we have pulled, as an ISO string. */
  lastPulledAt: string | null
  /** Stable per-installation id; the server uses it to skip echoing our own writes. */
  deviceId: string
  /** Set once the legacy MMKV notes have been imported. */
  legacyImported: boolean
}

export interface PendingChanges {
  notes: Note[]
  systems: NoteSystem[]
  links: NoteLink[]
}

export interface LocalStore {
  init(): Promise<void>

  listNotes(options?: { includeDeleted?: boolean }): Promise<Note[]>
  getNote(id: string): Promise<Note | null>
  putNotes(notes: Note[]): Promise<void>

  listSystems(options?: { includeDeleted?: boolean }): Promise<NoteSystem[]>
  putSystems(systems: NoteSystem[]): Promise<void>

  listLinks(options?: { includeDeleted?: boolean }): Promise<NoteLink[]>
  putLinks(links: NoteLink[]): Promise<void>

  /** Rows with local edits the server has not acknowledged. */
  pendingChanges(limit?: number): Promise<PendingChanges>

  /**
   * Applies server-canonical rows. Implementations must clear `dirty` only for
   * rows whose local `updatedAt` did not move while the request was in flight,
   * or a concurrent edit would be silently dropped.
   */
  applyRemote(changes: PendingChanges): Promise<void>

  /** Stamps `userId` on every local row — used when an anonymous user signs in. */
  claimForUser(userId: string): Promise<number>

  /** Drops tombstones older than `olderThan` (epoch ms). Returns rows removed. */
  purgeTombstones(olderThan: number): Promise<number>

  getMeta(): Promise<SyncMeta>
  setMeta(patch: Partial<SyncMeta>): Promise<void>

  clear(): Promise<void>
}
