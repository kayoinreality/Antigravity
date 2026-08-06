import { contentTerms } from '../text/normalize'
import type { Note } from '../model/types'

/**
 * Sparse TF-IDF vectors over note text.
 *
 * Kept lexical on purpose: this runs on the user's device, offline, with no API
 * key and no note text leaving it. `SemanticProvider` in `provider.ts` is the
 * seam for swapping in embeddings later without touching the clustering itself.
 */

export type SparseVector = Map<string, number>

/** Terms per note. Beyond this the tail contributes noise, not signal. */
const MAX_TERMS = 32

export interface Corpus {
  /** term -> number of notes containing it. */
  documentFrequency: Map<string, number>
  documentCount: number
}

export function buildCorpus(notes: Note[]): Corpus {
  const documentFrequency = new Map<string, number>()

  for (const note of notes) {
    const seen = new Set(contentTerms(`${note.title}\n${note.content}`))
    for (const term of seen) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
    }
  }

  return { documentFrequency, documentCount: notes.length }
}

export function buildVector(note: Note, corpus: Corpus): SparseVector {
  const terms = contentTerms(`${note.title}\n${note.content}`)
  if (terms.length === 0) return new Map()

  const termFrequency = new Map<string, number>()
  for (const term of terms) {
    termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1)
  }

  const weighted: Array<[string, number]> = []
  for (const [term, tf] of termFrequency) {
    const df = corpus.documentFrequency.get(term) ?? 1
    // A term that appears in every note ("nota", "todo") carries no grouping
    // information, and smoothed IDF drives it to ~0 without a hard stoplist.
    const idf = Math.log(1 + corpus.documentCount / df)
    weighted.push([term, (1 + Math.log(tf)) * idf])
  }

  weighted.sort((a, b) => b[1] - a[1])
  const top = weighted.slice(0, MAX_TERMS)

  const norm = Math.sqrt(top.reduce((sum, [, w]) => sum + w * w, 0))
  if (norm === 0) return new Map()

  return new Map(top.map(([term, w]) => [term, w / norm]))
}

/** Both vectors are L2-normalized, so the dot product is the cosine. */
export function cosine(a: SparseVector, b: SparseVector): number {
  // Iterate the smaller side; note vectors are capped at MAX_TERMS but this
  // still halves the work on lopsided pairs.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let sum = 0
  for (const [term, weight] of small) {
    const other = large.get(term)
    if (other !== undefined) sum += weight * other
  }
  return sum
}

export function centroid(vectors: SparseVector[]): SparseVector {
  const totals = new Map<string, number>()
  for (const vector of vectors) {
    for (const [term, weight] of vector) {
      totals.set(term, (totals.get(term) ?? 0) + weight)
    }
  }

  let norm = 0
  for (const weight of totals.values()) norm += weight * weight
  norm = Math.sqrt(norm)
  if (norm === 0) return new Map()

  for (const [term, weight] of totals) totals.set(term, weight / norm)
  return totals
}
