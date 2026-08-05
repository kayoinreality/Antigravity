import { acknowledge, mergeRows } from './merge'
import type { LocalStore, PendingChanges } from '../storage/local-store'
import type { Note, NoteLink, NoteSystem } from '../model/types'

/**
 * Local-first sync loop.
 *
 * The local database is the source of truth; the server is a replica the app
 * pushes to and pulls from. Everything works with the network off, and the
 * outbox drains when it comes back. That ordering is deliberate: a notes app
 * that blocks on a request to show you your own notes is a worse notes app.
 *
 * One cycle is: push everything dirty, then pull everything newer than our
 * cursor. Push first so our own writes come back as confirmations rather than
 * arriving as surprises after we have already applied someone else's.
 */

export type SyncStatus = 'idle' | 'pushing' | 'pulling' | 'offline' | 'error' | 'disabled'

export interface RemoteAdapter {
  /** The signed-in user, or null when anonymous. */
  currentUserId(): string | null
  push(changes: PendingChanges): Promise<PendingChanges>
  pull(since: string | null, limit: number): Promise<{ changes: PendingChanges; cursor: string | null; hasMore: boolean }>
  /** Live updates. Returns an unsubscribe function. */
  subscribe(onChange: () => void): () => void
}

export interface SyncEngineOptions {
  store: LocalStore
  remote: RemoteAdapter | null
  /** Rows per request. Keeps payloads and memory bounded on large canvases. */
  batchSize?: number
  /** Tombstones older than this are purged locally. */
  tombstoneTtlMs?: number
  onStatusChange?: (status: SyncStatus, detail?: string) => void
  onApplied?: () => void
  now?: () => number
}

const DEFAULT_BATCH = 500
const THIRTY_DAYS = 30 * 86_400_000

export class SyncEngine {
  private readonly store: LocalStore
  private readonly remote: RemoteAdapter | null
  private readonly batchSize: number
  private readonly tombstoneTtl: number
  private readonly onStatusChange: (status: SyncStatus, detail?: string) => void
  private readonly onApplied: () => void
  private readonly now: () => number

  private status: SyncStatus = 'idle'
  private running = false
  /** Set when a change lands mid-cycle, so we immediately go round again. */
  private requeued = false
  private unsubscribe: (() => void) | null = null

  constructor(options: SyncEngineOptions) {
    this.store = options.store
    this.remote = options.remote
    this.batchSize = options.batchSize ?? DEFAULT_BATCH
    this.tombstoneTtl = options.tombstoneTtlMs ?? THIRTY_DAYS
    this.onStatusChange = options.onStatusChange ?? (() => {})
    this.onApplied = options.onApplied ?? (() => {})
    this.now = options.now ?? Date.now
    if (!this.remote) this.setStatus('disabled')
  }

  start(): void {
    if (!this.remote || this.unsubscribe) return
    this.unsubscribe = this.remote.subscribe(() => {
      void this.sync()
    })
    void this.sync()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  getStatus(): SyncStatus {
    return this.status
  }

  /** Runs one full cycle. Concurrent calls collapse into one re-run. */
  async sync(): Promise<void> {
    if (!this.remote) return
    if (this.running) {
      this.requeued = true
      return
    }

    this.running = true
    try {
      do {
        this.requeued = false
        await this.runCycle()
      } while (this.requeued)
      this.setStatus('idle')
    } catch (error) {
      this.setStatus(isOffline(error) ? 'offline' : 'error', describe(error))
    } finally {
      this.running = false
    }
  }

  private async runCycle(): Promise<void> {
    const remote = this.remote!
    if (!remote.currentUserId()) {
      // Anonymous: nothing to sync to yet, but local editing keeps working.
      this.setStatus('disabled')
      return
    }

    this.setStatus('pushing')
    await this.pushAll()

    this.setStatus('pulling')
    await this.pullAll()

    await this.store.purgeTombstones(this.now() - this.tombstoneTtl)
  }

  private async pushAll(): Promise<void> {
    const remote = this.remote!

    for (;;) {
      const pending = await this.store.pendingChanges(this.batchSize)
      if (isEmptyChanges(pending)) return

      const echoed = await remote.push(pending)

      const [notes, systems, links] = await Promise.all([
        this.store.listNotes({ includeDeleted: true }),
        this.store.listSystems({ includeDeleted: true }),
        this.store.listLinks({ includeDeleted: true }),
      ])

      await this.store.applyRemote({
        notes: acknowledge(pending.notes, echoed.notes, indexById(notes)),
        systems: acknowledge(pending.systems, echoed.systems, indexById(systems)),
        links: acknowledge(pending.links, echoed.links, indexById(links)),
      })

      if (countChanges(pending) < this.batchSize) return
    }
  }

  private async pullAll(): Promise<void> {
    const remote = this.remote!
    const meta = await this.store.getMeta()
    let cursor = meta.lastPulledAt

    for (;;) {
      const page = await remote.pull(cursor, this.batchSize)
      if (isEmptyChanges(page.changes)) {
        if (page.cursor && page.cursor !== cursor) {
          await this.store.setMeta({ lastPulledAt: page.cursor })
        }
        return
      }

      const [notes, systems, links] = await Promise.all([
        this.store.listNotes({ includeDeleted: true }),
        this.store.listSystems({ includeDeleted: true }),
        this.store.listLinks({ includeDeleted: true }),
      ])

      const mergedNotes = mergeRows<Note>(notes, page.changes.notes)
      const mergedSystems = mergeRows<NoteSystem>(systems, page.changes.systems)
      const mergedLinks = mergeRows<NoteLink>(links, page.changes.links)

      await this.store.applyRemote({
        notes: mergedNotes.merged,
        systems: mergedSystems.merged,
        links: mergedLinks.merged,
      })

      cursor = page.cursor
      await this.store.setMeta({ lastPulledAt: cursor })
      this.onApplied()

      // Rows that lost to a local edit go back out on the next push.
      if (
        mergedNotes.stillDirty.length > 0 ||
        mergedSystems.stillDirty.length > 0 ||
        mergedLinks.stillDirty.length > 0
      ) {
        this.requeued = true
      }

      if (!page.hasMore) return
    }
  }

  /**
   * Moves everything created while anonymous into the account that just signed
   * in, then pushes. Without this, signing in would appear to erase the canvas.
   */
  async claimLocalNotes(userId: string): Promise<number> {
    const claimed = await this.store.claimForUser(userId)
    if (claimed > 0) await this.sync()
    return claimed
  }

  private setStatus(status: SyncStatus, detail?: string): void {
    if (this.status === status) return
    this.status = status
    this.onStatusChange(status, detail)
  }
}

const indexById = <T extends { id: string }>(rows: T[]): Map<string, T> =>
  new Map(rows.map((row) => [row.id, row]))

const countChanges = (changes: PendingChanges): number =>
  changes.notes.length + changes.systems.length + changes.links.length

const isEmptyChanges = (changes: PendingChanges): boolean => countChanges(changes) === 0

function isOffline(error: unknown): boolean {
  // `navigator` exists in browsers and React Native but not in Node, and core
  // has no DOM lib on purpose — probe it rather than declaring it.
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator
  if (nav?.onLine === false) return true
  const message = describe(error).toLowerCase()
  return (
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('timeout') ||
    message.includes('econnrefused')
  )
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
