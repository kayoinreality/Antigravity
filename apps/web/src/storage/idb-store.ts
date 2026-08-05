import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { uuid, type LocalStore, type Note, type NoteLink, type NoteSystem, type PendingChanges, type SyncMeta } from '@antigravity/core'

/**
 * IndexedDB implementation of LocalStore.
 *
 * The browser holds the full working set — a note is a few hundred bytes, so
 * even a decade of them fits comfortably — and search runs against an in-memory
 * index built from it at boot. That is why this is IndexedDB and not SQLite via
 * wasm: expo-sqlite's FTS5 does not work on web (`no such module: fts5`), so
 * sharing the mobile storage layer would buy a WASM download and still leave
 * text search to be solved separately.
 */

interface AntigravityDB extends DBSchema {
  notes: {
    key: string
    value: Note
    indexes: { 'by-dirty': number; 'by-updated': number }
  }
  systems: {
    key: string
    value: NoteSystem
    indexes: { 'by-dirty': number }
  }
  links: {
    key: string
    value: NoteLink
    indexes: { 'by-dirty': number }
  }
  meta: {
    key: string
    value: unknown
  }
}

const DB_NAME = 'antigravity'
const DB_VERSION = 1

/**
 * IndexedDB cannot index a boolean, so `dirty` is mirrored to 0/1 on the way
 * in. Keeping the mirror inside the store means nothing above it has to know.
 */
type Stored<T> = T & { dirtyFlag: number }

const store = <T extends { dirty: boolean }>(row: T): Stored<T> => ({
  ...row,
  dirtyFlag: row.dirty ? 1 : 0,
})

const load = <T>(row: Stored<T & { dirty: boolean }>): T => {
  const { dirtyFlag: _dirtyFlag, ...rest } = row
  return rest as unknown as T
}

export class IdbStore implements LocalStore {
  private db: IDBPDatabase<AntigravityDB> | null = null

  async init(): Promise<void> {
    if (this.db) return

    this.db = await openDB<AntigravityDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const notes = db.createObjectStore('notes', { keyPath: 'id' })
        notes.createIndex('by-dirty', 'dirtyFlag')
        notes.createIndex('by-updated', 'updatedAt')

        db.createObjectStore('systems', { keyPath: 'id' }).createIndex('by-dirty', 'dirtyFlag')
        db.createObjectStore('links', { keyPath: 'id' }).createIndex('by-dirty', 'dirtyFlag')
        db.createObjectStore('meta')
      },
    })

    // Every install needs a stable device id; generate it once, on first open.
    const existing = await this.db.get('meta', 'deviceId')
    if (!existing) await this.db.put('meta', uuid(), 'deviceId')
  }

  private get database(): IDBPDatabase<AntigravityDB> {
    if (!this.db) throw new Error('IdbStore.init() has not completed')
    return this.db
  }

  async listNotes(options?: { includeDeleted?: boolean }): Promise<Note[]> {
    const all = (await this.database.getAll('notes')) as Array<Stored<Note>>
    const rows = all.map(load<Note>)
    return options?.includeDeleted ? rows : rows.filter((n) => n.deletedAt === null)
  }

  async getNote(id: string): Promise<Note | null> {
    const row = (await this.database.get('notes', id)) as Stored<Note> | undefined
    return row ? load<Note>(row) : null
  }

  async putNotes(notes: Note[]): Promise<void> {
    if (notes.length === 0) return
    const tx = this.database.transaction('notes', 'readwrite')
    await Promise.all([...notes.map((note) => tx.store.put(store(note))), tx.done])
  }

  async listSystems(options?: { includeDeleted?: boolean }): Promise<NoteSystem[]> {
    const all = (await this.database.getAll('systems')) as Array<Stored<NoteSystem>>
    const rows = all.map(load<NoteSystem>)
    return options?.includeDeleted ? rows : rows.filter((s) => s.deletedAt === null)
  }

  async putSystems(systems: NoteSystem[]): Promise<void> {
    if (systems.length === 0) return
    const tx = this.database.transaction('systems', 'readwrite')
    await Promise.all([...systems.map((s) => tx.store.put(store(s))), tx.done])
  }

  async listLinks(options?: { includeDeleted?: boolean }): Promise<NoteLink[]> {
    const all = (await this.database.getAll('links')) as Array<Stored<NoteLink>>
    const rows = all.map(load<NoteLink>)
    return options?.includeDeleted ? rows : rows.filter((l) => l.deletedAt === null)
  }

  async putLinks(links: NoteLink[]): Promise<void> {
    if (links.length === 0) return
    const tx = this.database.transaction('links', 'readwrite')
    await Promise.all([...links.map((l) => tx.store.put(store(l))), tx.done])
  }

  async pendingChanges(limit = 500): Promise<PendingChanges> {
    const [notes, systems, links] = await Promise.all([
      this.database.getAllFromIndex('notes', 'by-dirty', 1, limit),
      this.database.getAllFromIndex('systems', 'by-dirty', 1, limit),
      this.database.getAllFromIndex('links', 'by-dirty', 1, limit),
    ])

    return {
      notes: (notes as Array<Stored<Note>>).map(load<Note>),
      systems: (systems as Array<Stored<NoteSystem>>).map(load<NoteSystem>),
      links: (links as Array<Stored<NoteLink>>).map(load<NoteLink>),
    }
  }

  async applyRemote(changes: PendingChanges): Promise<void> {
    await Promise.all([
      this.putNotes(changes.notes),
      this.putSystems(changes.systems),
      this.putLinks(changes.links),
    ])
  }

  async claimForUser(userId: string): Promise<number> {
    const [notes, systems, links] = await Promise.all([
      this.listNotes({ includeDeleted: true }),
      this.listSystems({ includeDeleted: true }),
      this.listLinks({ includeDeleted: true }),
    ])

    // Only rows that have no owner yet. Anything already stamped belongs to a
    // previous session and must not be silently transferred between accounts.
    const orphanNotes = notes.filter((n) => n.userId === null)
    const orphanSystems = systems.filter((s) => s.userId === null)
    const orphanLinks = links.filter((l) => l.userId === null)

    await Promise.all([
      this.putNotes(orphanNotes.map((n) => ({ ...n, userId, dirty: true }))),
      this.putSystems(orphanSystems.map((s) => ({ ...s, userId, dirty: true }))),
      this.putLinks(orphanLinks.map((l) => ({ ...l, userId, dirty: true }))),
    ])

    return orphanNotes.length + orphanSystems.length + orphanLinks.length
  }

  async purgeTombstones(olderThan: number): Promise<number> {
    let removed = 0

    for (const name of ['notes', 'systems', 'links'] as const) {
      const tx = this.database.transaction(name, 'readwrite')
      const rows = (await tx.store.getAll()) as Array<{ id: string; deletedAt: number | null; dirty: boolean }>

      for (const row of rows) {
        // A tombstone that has not synced yet still has to reach the server, so
        // expiry alone is not enough to drop it.
        if (row.deletedAt !== null && row.deletedAt < olderThan && !row.dirty) {
          await tx.store.delete(row.id)
          removed += 1
        }
      }

      await tx.done
    }

    return removed
  }

  async getMeta(): Promise<SyncMeta> {
    const [lastPulledAt, deviceId, legacyImported] = await Promise.all([
      this.database.get('meta', 'lastPulledAt'),
      this.database.get('meta', 'deviceId'),
      this.database.get('meta', 'legacyImported'),
    ])

    return {
      lastPulledAt: (lastPulledAt as string | undefined) ?? null,
      deviceId: (deviceId as string | undefined) ?? 'unknown',
      legacyImported: Boolean(legacyImported),
    }
  }

  async setMeta(patch: Partial<SyncMeta>): Promise<void> {
    const tx = this.database.transaction('meta', 'readwrite')
    for (const [key, value] of Object.entries(patch)) {
      await tx.store.put(value, key)
    }
    await tx.done
  }

  async clear(): Promise<void> {
    const tx = this.database.transaction(['notes', 'systems', 'links'], 'readwrite')
    await Promise.all([
      tx.objectStore('notes').clear(),
      tx.objectStore('systems').clear(),
      tx.objectStore('links').clear(),
      tx.done,
    ])
  }
}
