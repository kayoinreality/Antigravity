import * as SQLite from 'expo-sqlite'
import {
  uuid,
  type LocalStore,
  type Note,
  type NoteLink,
  type NoteSystem,
  type PendingChanges,
  type SyncMeta,
} from '@antigravity/core'

/**
 * SQLite implementation of LocalStore.
 *
 * The previous build kept every note in one MMKV key and rewrote the entire
 * JSON blob on each drag — with a thousand notes, dragging one serialized all
 * thousand, on the JS thread, per gesture. Here a move is
 * `UPDATE notes SET x=?,y=? WHERE id=?` and touches one row.
 *
 * Text search uses FTS5 with `remove_diacritics 2`, which is what makes
 * "analise" find "análise" on the database side. It is kept in sync by triggers
 * rather than by application code, so there is no path that writes a note and
 * forgets to reindex it.
 */

const DB_NAME = 'antigravity.db'

/** Columns whose predicates are cheap and indexed enough to push into SQL. */
export const SQL_HANDLED_FILTERS = new Set(['date', 'color', 'system', 'flag'])

interface NoteRow {
  id: string
  user_id: string | null
  title: string
  content: string
  x: number
  y: number
  color: string
  tags: string
  system_id: string | null
  orbit_radius: number | null
  orbit_angle: number | null
  pinned: number
  created_at: number
  updated_at: number
  deleted_at: number | null
  rev: number
  dirty: number
}

interface SystemRow {
  id: string
  user_id: string | null
  label: string
  terms: string
  centroid_x: number
  centroid_y: number
  accepted_at: number | null
  created_at: number
  updated_at: number
  deleted_at: number | null
  rev: number
  dirty: number
}

interface LinkRow {
  id: string
  user_id: string | null
  from_id: string
  to_id: string
  created_at: number
  updated_at: number
  deleted_at: number | null
  rev: number
  dirty: number
}

const toNote = (row: NoteRow): Note => ({
  id: row.id,
  userId: row.user_id,
  title: row.title,
  content: row.content,
  x: row.x,
  y: row.y,
  color: row.color,
  tags: JSON.parse(row.tags) as string[],
  systemId: row.system_id,
  orbitRadius: row.orbit_radius,
  orbitAngle: row.orbit_angle,
  pinned: row.pinned === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
  rev: row.rev,
  dirty: row.dirty === 1,
})

const toSystem = (row: SystemRow): NoteSystem => ({
  id: row.id,
  userId: row.user_id,
  label: row.label,
  terms: JSON.parse(row.terms) as string[],
  centroidX: row.centroid_x,
  centroidY: row.centroid_y,
  acceptedAt: row.accepted_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
  rev: row.rev,
  dirty: row.dirty === 1,
})

const toLink = (row: LinkRow): NoteLink => ({
  id: row.id,
  userId: row.user_id,
  fromId: row.from_id,
  toId: row.to_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
  rev: row.rev,
  dirty: row.dirty === 1,
})

export class SqliteStore implements LocalStore {
  private db: SQLite.SQLiteDatabase | null = null
  private ftsAvailable = true

  async init(): Promise<void> {
    if (this.db) return

    this.db = await SQLite.openDatabaseAsync(DB_NAME)
    // WAL: the clustering pass reads the whole table on a background task while
    // the user keeps editing. Without it those readers block the writer.
    await this.db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')

    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS notes (
        id           TEXT PRIMARY KEY NOT NULL,
        user_id      TEXT,
        title        TEXT NOT NULL DEFAULT '',
        content      TEXT NOT NULL DEFAULT '',
        x            REAL NOT NULL DEFAULT 0,
        y            REAL NOT NULL DEFAULT 0,
        color        TEXT NOT NULL,
        tags         TEXT NOT NULL DEFAULT '[]',
        system_id    TEXT,
        orbit_radius REAL,
        orbit_angle  REAL,
        pinned       INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        deleted_at   INTEGER,
        rev          INTEGER NOT NULL DEFAULT 0,
        dirty        INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS systems (
        id          TEXT PRIMARY KEY NOT NULL,
        user_id     TEXT,
        label       TEXT NOT NULL DEFAULT '',
        terms       TEXT NOT NULL DEFAULT '[]',
        centroid_x  REAL NOT NULL DEFAULT 0,
        centroid_y  REAL NOT NULL DEFAULT 0,
        accepted_at INTEGER,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        deleted_at  INTEGER,
        rev         INTEGER NOT NULL DEFAULT 0,
        dirty       INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS links (
        id         TEXT PRIMARY KEY NOT NULL,
        user_id    TEXT,
        from_id    TEXT NOT NULL,
        to_id      TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        rev        INTEGER NOT NULL DEFAULT 0,
        dirty      INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY NOT NULL,
        value TEXT
      );

      CREATE INDEX IF NOT EXISTS notes_dirty_idx ON notes (dirty) WHERE dirty = 1;
      CREATE INDEX IF NOT EXISTS notes_alive_idx ON notes (deleted_at);
      CREATE INDEX IF NOT EXISTS notes_updated_idx ON notes (updated_at);
      CREATE INDEX IF NOT EXISTS notes_system_idx ON notes (system_id);
      CREATE INDEX IF NOT EXISTS links_from_idx ON links (from_id);
      CREATE INDEX IF NOT EXISTS links_to_idx ON links (to_id);
      CREATE INDEX IF NOT EXISTS systems_dirty_idx ON systems (dirty) WHERE dirty = 1;
      CREATE INDEX IF NOT EXISTS links_dirty_idx ON links (dirty) WHERE dirty = 1;
    `)

    await this.setupFts()

    const deviceId = await this.readMeta('deviceId')
    if (!deviceId) await this.writeMeta('deviceId', uuid())
  }

  /**
   * FTS5 is compiled into expo-sqlite on native but the build is not guaranteed
   * everywhere, so its absence downgrades search to LIKE rather than crashing
   * the app on first launch.
   */
  private async setupFts(): Promise<void> {
    try {
      await this.database.execAsync(`
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
          title, content, tags,
          content='notes',
          content_rowid='rowid',
          tokenize="unicode61 remove_diacritics 2"
        );

        CREATE TRIGGER IF NOT EXISTS notes_fts_insert AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts(rowid, title, content, tags)
          VALUES (new.rowid, new.title, new.content, new.tags);
        END;

        CREATE TRIGGER IF NOT EXISTS notes_fts_delete AFTER DELETE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, content, tags)
          VALUES ('delete', old.rowid, old.title, old.content, old.tags);
        END;

        CREATE TRIGGER IF NOT EXISTS notes_fts_update AFTER UPDATE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, content, tags)
          VALUES ('delete', old.rowid, old.title, old.content, old.tags);
          INSERT INTO notes_fts(rowid, title, content, tags)
          VALUES (new.rowid, new.title, new.content, new.tags);
        END;
      `)
      this.ftsAvailable = true
    } catch (error) {
      console.warn('[SqliteStore] FTS5 unavailable, falling back to LIKE:', error)
      this.ftsAvailable = false
    }
  }

  get hasFts(): boolean {
    return this.ftsAvailable
  }

  private get database(): SQLite.SQLiteDatabase {
    if (!this.db) throw new Error('SqliteStore.init() has not completed')
    return this.db
  }

  async listNotes(options?: { includeDeleted?: boolean }): Promise<Note[]> {
    const where = options?.includeDeleted ? '' : 'WHERE deleted_at IS NULL'
    const rows = await this.database.getAllAsync<NoteRow>(
      `SELECT * FROM notes ${where} ORDER BY created_at`,
    )
    return rows.map(toNote)
  }

  async getNote(id: string): Promise<Note | null> {
    const row = await this.database.getFirstAsync<NoteRow>('SELECT * FROM notes WHERE id = ?', id)
    return row ? toNote(row) : null
  }

  async putNotes(notes: Note[]): Promise<void> {
    if (notes.length === 0) return

    await this.database.withTransactionAsync(async () => {
      for (const note of notes) {
        await this.database.runAsync(
          `INSERT INTO notes
             (id, user_id, title, content, x, y, color, tags, system_id,
              orbit_radius, orbit_angle, pinned, created_at, updated_at,
              deleted_at, rev, dirty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             user_id      = excluded.user_id,
             title        = excluded.title,
             content      = excluded.content,
             x            = excluded.x,
             y            = excluded.y,
             color        = excluded.color,
             tags         = excluded.tags,
             system_id    = excluded.system_id,
             orbit_radius = excluded.orbit_radius,
             orbit_angle  = excluded.orbit_angle,
             pinned       = excluded.pinned,
             updated_at   = excluded.updated_at,
             deleted_at   = excluded.deleted_at,
             rev          = excluded.rev,
             dirty        = excluded.dirty`,
          note.id,
          note.userId,
          note.title,
          note.content,
          note.x,
          note.y,
          note.color,
          JSON.stringify(note.tags),
          note.systemId,
          note.orbitRadius,
          note.orbitAngle,
          note.pinned ? 1 : 0,
          note.createdAt,
          note.updatedAt,
          note.deletedAt,
          note.rev,
          note.dirty ? 1 : 0,
        )
      }
    })
  }

  /** The hot path during a drag: one row, two columns, no serialization. */
  async moveNote(id: string, x: number, y: number, updatedAt: number): Promise<void> {
    await this.database.runAsync(
      'UPDATE notes SET x = ?, y = ?, updated_at = ?, dirty = 1 WHERE id = ?',
      x,
      y,
      updatedAt,
      id,
    )
  }

  async listSystems(options?: { includeDeleted?: boolean }): Promise<NoteSystem[]> {
    const where = options?.includeDeleted ? '' : 'WHERE deleted_at IS NULL'
    const rows = await this.database.getAllAsync<SystemRow>(`SELECT * FROM systems ${where}`)
    return rows.map(toSystem)
  }

  async putSystems(systems: NoteSystem[]): Promise<void> {
    if (systems.length === 0) return

    await this.database.withTransactionAsync(async () => {
      for (const system of systems) {
        await this.database.runAsync(
          `INSERT INTO systems
             (id, user_id, label, terms, centroid_x, centroid_y, accepted_at,
              created_at, updated_at, deleted_at, rev, dirty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             user_id     = excluded.user_id,
             label       = excluded.label,
             terms       = excluded.terms,
             centroid_x  = excluded.centroid_x,
             centroid_y  = excluded.centroid_y,
             accepted_at = excluded.accepted_at,
             updated_at  = excluded.updated_at,
             deleted_at  = excluded.deleted_at,
             rev         = excluded.rev,
             dirty       = excluded.dirty`,
          system.id,
          system.userId,
          system.label,
          JSON.stringify(system.terms),
          system.centroidX,
          system.centroidY,
          system.acceptedAt,
          system.createdAt,
          system.updatedAt,
          system.deletedAt,
          system.rev,
          system.dirty ? 1 : 0,
        )
      }
    })
  }

  async listLinks(options?: { includeDeleted?: boolean }): Promise<NoteLink[]> {
    const where = options?.includeDeleted ? '' : 'WHERE deleted_at IS NULL'
    const rows = await this.database.getAllAsync<LinkRow>(`SELECT * FROM links ${where}`)
    return rows.map(toLink)
  }

  async putLinks(links: NoteLink[]): Promise<void> {
    if (links.length === 0) return

    await this.database.withTransactionAsync(async () => {
      for (const link of links) {
        await this.database.runAsync(
          `INSERT INTO links
             (id, user_id, from_id, to_id, created_at, updated_at, deleted_at, rev, dirty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             user_id    = excluded.user_id,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             rev        = excluded.rev,
             dirty      = excluded.dirty`,
          link.id,
          link.userId,
          link.fromId,
          link.toId,
          link.createdAt,
          link.updatedAt,
          link.deletedAt,
          link.rev,
          link.dirty ? 1 : 0,
        )
      }
    })
  }

  async pendingChanges(limit = 500): Promise<PendingChanges> {
    const [notes, systems, links] = await Promise.all([
      this.database.getAllAsync<NoteRow>('SELECT * FROM notes WHERE dirty = 1 LIMIT ?', limit),
      this.database.getAllAsync<SystemRow>('SELECT * FROM systems WHERE dirty = 1 LIMIT ?', limit),
      this.database.getAllAsync<LinkRow>('SELECT * FROM links WHERE dirty = 1 LIMIT ?', limit),
    ])

    return {
      notes: notes.map(toNote),
      systems: systems.map(toSystem),
      links: links.map(toLink),
    }
  }

  async applyRemote(changes: PendingChanges): Promise<void> {
    await this.putSystems(changes.systems)
    await this.putNotes(changes.notes)
    await this.putLinks(changes.links)
  }

  async claimForUser(userId: string): Promise<number> {
    let claimed = 0

    await this.database.withTransactionAsync(async () => {
      for (const table of ['notes', 'systems', 'links']) {
        // Only unowned rows. Anything already stamped belongs to a previous
        // session and must not be silently transferred between accounts.
        const result = await this.database.runAsync(
          `UPDATE ${table} SET user_id = ?, dirty = 1 WHERE user_id IS NULL`,
          userId,
        )
        claimed += result.changes
      }
    })

    return claimed
  }

  async purgeTombstones(olderThan: number): Promise<number> {
    let removed = 0

    await this.database.withTransactionAsync(async () => {
      for (const table of ['links', 'notes', 'systems']) {
        // `dirty = 0` guards a tombstone that has not reached the server yet:
        // dropping it locally would resurrect the row on the next pull.
        const result = await this.database.runAsync(
          `DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ? AND dirty = 0`,
          olderThan,
        )
        removed += result.changes
      }
    })

    return removed
  }

  private async readMeta(key: string): Promise<string | null> {
    const row = await this.database.getFirstAsync<{ value: string | null }>(
      'SELECT value FROM meta WHERE key = ?',
      key,
    )
    return row?.value ?? null
  }

  private async writeMeta(key: string, value: string | null): Promise<void> {
    await this.database.runAsync(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    )
  }

  async getMeta(): Promise<SyncMeta> {
    const [lastPulledAt, deviceId, legacyImported] = await Promise.all([
      this.readMeta('lastPulledAt'),
      this.readMeta('deviceId'),
      this.readMeta('legacyImported'),
    ])

    return {
      lastPulledAt,
      deviceId: deviceId ?? 'unknown',
      legacyImported: legacyImported === 'true',
    }
  }

  async setMeta(patch: Partial<SyncMeta>): Promise<void> {
    for (const [key, value] of Object.entries(patch)) {
      await this.writeMeta(key, value === null ? null : String(value))
    }
  }

  async clear(): Promise<void> {
    await this.database.execAsync('DELETE FROM notes; DELETE FROM systems; DELETE FROM links;')
  }

  /**
   * Full-text candidate ids with their bm25 scores.
   *
   * FTS5 returns bm25() as a negative number where more-negative is better;
   * `normalizeBm25` in core flips that so the shared ranking formula never has
   * to know about the quirk.
   */
  async searchText(text: string): Promise<Map<string, number>> {
    const scores = new Map<string, number>()
    const trimmed = text.trim()
    if (!trimmed) return scores

    if (!this.ftsAvailable) {
      const like = `%${trimmed}%`
      const rows = await this.database.getAllAsync<{ id: string }>(
        'SELECT id FROM notes WHERE deleted_at IS NULL AND (title LIKE ? OR content LIKE ?)',
        like,
        like,
      )
      for (const row of rows) scores.set(row.id, 1)
      return scores
    }

    // Prefix-match the final token so results update while the user is typing.
    // Each token is quoted because FTS5 treats bare punctuation as syntax and a
    // stray hyphen would otherwise be a query error, not a search.
    const tokens = trimmed.split(/\s+/).filter(Boolean)
    const query = tokens
      .map((token, i) => {
        const escaped = token.replace(/"/g, '""')
        return i === tokens.length - 1 ? `"${escaped}"*` : `"${escaped}"`
      })
      .join(' AND ')

    try {
      const rows = await this.database.getAllAsync<{ id: string; score: number }>(
        `SELECT n.id AS id, bm25(notes_fts, 3.0, 1.0, 2.0) AS score
           FROM notes_fts
           JOIN notes n ON n.rowid = notes_fts.rowid
          WHERE notes_fts MATCH ? AND n.deleted_at IS NULL`,
        query,
      )
      for (const row of rows) scores.set(row.id, row.score)
    } catch (error) {
      console.warn('[SqliteStore] FTS query failed:', error)
    }

    return scores
  }
}
