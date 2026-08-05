import type { Note, NoteLink, NoteSystem } from '../model/types'

/**
 * Conflict resolution.
 *
 * Last-write-wins per row, on `updatedAt`, with `rev` as the tiebreaker. Not a
 * CRDT — that would be the right call for collaborative editing of one
 * document, but this is a personal canvas where the realistic conflict is "the
 * same note edited on the phone and the laptop while offline", and there LWW
 * gives an answer the user can predict. The cost, stated plainly: the losing
 * side's edit to that note is discarded, not merged.
 *
 * Position is part of the row, so moving a note on one device and editing its
 * text on another resolves to whichever happened later. That is the tradeoff we
 * accept for not carrying per-field clocks.
 */

export interface Syncable {
  id: string
  updatedAt: number
  rev: number
  dirty: boolean
}

export type MergeOutcome = 'remote' | 'local' | 'identical'

export function decide<T extends Syncable>(local: T | undefined, remote: T): MergeOutcome {
  if (!local) return 'remote'
  if (local.updatedAt < remote.updatedAt) return 'remote'
  if (local.updatedAt > remote.updatedAt) return 'local'
  // Same millisecond: the server's revision counter is the only total order
  // available, and it is monotonic per row.
  if (remote.rev > local.rev) return 'remote'
  if (remote.rev < local.rev) return 'local'
  return 'identical'
}

/**
 * Folds a page of server rows into local ones.
 *
 * A row that loses to a local edit is *kept dirty* rather than dropped, so the
 * next push re-sends it and the server converges to the same answer.
 */
export function mergeRows<T extends Syncable>(
  locals: T[],
  remotes: T[],
): { merged: T[]; stillDirty: T[] } {
  const byId = new Map(locals.map((row) => [row.id, row]))
  const merged: T[] = []
  const stillDirty: T[] = []

  for (const remote of remotes) {
    const local = byId.get(remote.id)
    const outcome = decide(local, remote)

    if (outcome === 'remote') {
      merged.push({ ...remote, dirty: false })
    } else if (outcome === 'local' && local) {
      stillDirty.push(local)
    } else if (local) {
      // Identical: the server has our version, so we can stop resending it.
      if (local.dirty) merged.push({ ...local, rev: remote.rev, dirty: false })
    }
  }

  return { merged, stillDirty }
}

/**
 * Acknowledges a push. The server echoes the row it stored; if our local copy
 * moved on since we sent it, the row stays dirty for the next round.
 */
export function acknowledge<T extends Syncable>(
  sent: T[],
  acknowledged: T[],
  current: Map<string, T>,
): T[] {
  const sentById = new Map(sent.map((row) => [row.id, row]))
  const out: T[] = []

  for (const ack of acknowledged) {
    const original = sentById.get(ack.id)
    const now = current.get(ack.id)
    if (!original || !now) continue

    if (now.updatedAt > original.updatedAt) continue // edited mid-flight
    out.push({ ...now, rev: ack.rev, dirty: false })
  }

  return out
}

export type SyncableNote = Note & Syncable
export type SyncableSystem = NoteSystem & Syncable
export type SyncableLink = NoteLink & Syncable
