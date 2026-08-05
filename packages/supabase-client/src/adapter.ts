import type { SupabaseClient } from '@supabase/supabase-js'
import type { PendingChanges, RemoteAdapter } from '@antigravity/core'
import {
  linkFromRow,
  linkToWire,
  noteFromRow,
  noteToWire,
  systemFromRow,
  systemToWire,
  type LinkRow,
  type NoteRow,
  type SystemRow,
} from './wire'

/**
 * The Supabase side of the sync engine.
 *
 * Everything goes through the two RPCs rather than PostgREST table calls: the
 * merge rule lives in the database, and letting a client upsert directly would
 * put a stale offline write one race away from overwriting a newer one.
 */

interface PushResponse {
  notes: NoteRow[]
  systems: SystemRow[]
  links: LinkRow[]
}

interface PullResponse extends PushResponse {
  cursor: string | null
  hasMore: boolean
}

export interface SupabaseAdapterOptions {
  client: SupabaseClient
  /** Notified when the realtime channel delivers a change from another device. */
  onRealtimeError?: (error: Error) => void
}

export class SupabaseAdapter implements RemoteAdapter {
  private readonly client: SupabaseClient
  private readonly onRealtimeError: (error: Error) => void
  private userId: string | null = null

  constructor(options: SupabaseAdapterOptions) {
    this.client = options.client
    this.onRealtimeError = options.onRealtimeError ?? (() => {})

    // Cached rather than awaited per call: the sync engine asks for the user id
    // on every cycle, and getSession() is async even when it only reads memory.
    void this.client.auth.getSession().then(({ data }) => {
      this.userId = data.session?.user.id ?? null
    })
    this.client.auth.onAuthStateChange((_event, session) => {
      this.userId = session?.user.id ?? null
    })
  }

  currentUserId(): string | null {
    return this.userId
  }

  async push(changes: PendingChanges): Promise<PendingChanges> {
    const { data, error } = await this.client.rpc('sync_push', {
      p_changes: {
        notes: changes.notes.map(noteToWire),
        systems: changes.systems.map(systemToWire),
        links: changes.links.map(linkToWire),
      },
    })

    if (error) throw new Error(`sync_push failed: ${error.message}`)

    const response = data as PushResponse
    return {
      notes: (response.notes ?? []).map(noteFromRow),
      systems: (response.systems ?? []).map(systemFromRow),
      links: (response.links ?? []).map(linkFromRow),
    }
  }

  async pull(
    since: string | null,
    limit: number,
  ): Promise<{ changes: PendingChanges; cursor: string | null; hasMore: boolean }> {
    const { data, error } = await this.client.rpc('sync_pull', {
      p_since: since,
      p_limit: limit,
    })

    if (error) throw new Error(`sync_pull failed: ${error.message}`)

    const response = data as PullResponse
    return {
      changes: {
        notes: (response.notes ?? []).map(noteFromRow),
        systems: (response.systems ?? []).map(systemFromRow),
        links: (response.links ?? []).map(linkFromRow),
      },
      cursor: response.cursor,
      hasMore: response.hasMore,
    }
  }

  /**
   * Realtime is only a nudge — it says "something changed", and the engine then
   * runs its normal pull. Applying the payload directly would bypass the merge
   * rules and skip anything that arrived while the socket was down.
   */
  subscribe(onChange: () => void): () => void {
    const channel = this.client
      .channel('antigravity-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'systems' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'note_links' }, onChange)
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.onRealtimeError(new Error(`realtime channel ${status}`))
        }
      })

    // Sign-in and sign-out both change what there is to sync, so treat them as
    // change events too. Without this, signing in leaves the canvas empty until
    // something else happens to trigger a cycle.
    const { data: authSub } = this.client.auth.onAuthStateChange(() => onChange())

    return () => {
      void this.client.removeChannel(channel)
      authSub.subscription.unsubscribe()
    }
  }

  async purgeRemoteTombstones(): Promise<number> {
    const { data, error } = await this.client.rpc('purge_tombstones', {
      p_older_than: '30 days',
    })
    if (error) throw new Error(`purge_tombstones failed: ${error.message}`)
    return (data as number) ?? 0
  }
}
