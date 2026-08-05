import { clusterNotes, type Cluster, type ClusterOptions } from './cluster'
import type { Note } from '../model/types'

/**
 * The seam for upgrading topic detection later.
 *
 * Today grouping is lexical: it matches on shared words, which means it misses
 * "faculdade" ~ "universidade". Swapping in embeddings (server-side, pgvector)
 * fixes that, and everything above this interface — the suggestion UI, the
 * orbit layout, the persistence — stays untouched when it happens.
 */
export interface SemanticProvider {
  readonly id: string
  /** Whether this provider can run right now (network, key, quota). */
  isAvailable(): boolean
  cluster(notes: Note[], options?: ClusterOptions): Promise<Cluster[]>
}

export class LexicalProvider implements SemanticProvider {
  readonly id = 'lexical'

  isAvailable(): boolean {
    return true
  }

  async cluster(notes: Note[], options?: ClusterOptions): Promise<Cluster[]> {
    return clusterNotes(notes, options)
  }
}

export interface SuggestionOptions extends ClusterOptions {
  /** Below this mean intra-cluster similarity we stay quiet. */
  minConfidence?: number
  /** Systems the user already dismissed, keyed by `suggestionKey`. */
  dismissed?: ReadonlySet<string>
}

export interface SystemSuggestion extends Cluster {
  /** Stable across runs for the same set of notes, so dismissals stick. */
  key: string
}

/**
 * Filters raw clusters down to the ones worth interrupting the user about:
 * confident enough, and made only of notes that are not already in a system.
 */
export function toSuggestions(
  clusters: Cluster[],
  notes: Note[],
  options: SuggestionOptions = {},
): SystemSuggestion[] {
  const minConfidence = options.minConfidence ?? 0.5
  const dismissed = options.dismissed ?? new Set<string>()
  const systemOf = new Map(notes.map((n) => [n.id, n.systemId]))

  const out: SystemSuggestion[] = []
  for (const cluster of clusters) {
    if (cluster.confidence < minConfidence) continue
    if (cluster.noteIds.some((id) => systemOf.get(id))) continue

    const key = suggestionKey(cluster.noteIds)
    if (dismissed.has(key)) continue

    out.push({ ...cluster, key })
  }
  return out
}

/** Order-independent identity for a set of notes. */
export function suggestionKey(noteIds: string[]): string {
  return [...noteIds].sort().join('|')
}
