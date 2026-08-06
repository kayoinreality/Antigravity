import { contentTerms, fold, stem } from '../text/normalize'

/**
 * A small BM25 inverted index.
 *
 * The web app needs full-text search in the browser, and mobile needs a
 * fallback for the rare case where FTS5 is unavailable. Rather than pull in a
 * search library for that, this implements the ~120 lines of BM25 we actually
 * use — which also means the ranking that `rank.ts` tests against is the same
 * code that ships, instead of a stand-in for someone else's scorer.
 *
 * Sized for a personal note collection: tens of thousands of short documents,
 * incremental add/remove, no persistence (rebuilt from the store on boot).
 */

const K1 = 1.2
const B = 0.75

/** Title matches matter far more than body matches for a note this short. */
const FIELD_BOOST = { title: 3, tags: 2, content: 1 } as const

export interface IndexableNote {
  id: string
  title: string
  content: string
  tags: string[]
}

interface Posting {
  /** Boosted term frequency. */
  tf: number
}

export class TextIndex {
  /** term -> docId -> posting */
  private postings = new Map<string, Map<string, Posting>>()
  /** docId -> boosted document length, for BM25 normalization. */
  private lengths = new Map<string, number>()
  /** docId -> the terms it contributed, so removal is O(terms) not O(index). */
  private docTerms = new Map<string, string[]>()
  private totalLength = 0

  get size(): number {
    return this.lengths.size
  }

  add(note: IndexableNote): void {
    this.remove(note.id)

    const counts = new Map<string, number>()
    const ingest = (value: string, boost: number): void => {
      for (const term of contentTerms(value)) {
        counts.set(term, (counts.get(term) ?? 0) + boost)
      }
    }

    ingest(note.title, FIELD_BOOST.title)
    ingest(note.content, FIELD_BOOST.content)
    ingest(note.tags.join(' '), FIELD_BOOST.tags)

    if (counts.size === 0) {
      // Still track the doc so `size` and average length stay honest.
      this.lengths.set(note.id, 0)
      this.docTerms.set(note.id, [])
      return
    }

    let length = 0
    for (const [term, tf] of counts) {
      let bucket = this.postings.get(term)
      if (!bucket) {
        bucket = new Map()
        this.postings.set(term, bucket)
      }
      bucket.set(note.id, { tf })
      length += tf
    }

    this.lengths.set(note.id, length)
    this.docTerms.set(note.id, [...counts.keys()])
    this.totalLength += length
  }

  remove(id: string): void {
    const terms = this.docTerms.get(id)
    if (!terms) return

    for (const term of terms) {
      const bucket = this.postings.get(term)
      if (!bucket) continue
      bucket.delete(id)
      if (bucket.size === 0) this.postings.delete(term)
    }

    this.totalLength -= this.lengths.get(id) ?? 0
    this.lengths.delete(id)
    this.docTerms.delete(id)
  }

  clear(): void {
    this.postings.clear()
    this.lengths.clear()
    this.docTerms.clear()
    this.totalLength = 0
  }

  /**
   * Scores documents against `query`. The final token is matched as a prefix so
   * results update sensibly while the user is still typing a word.
   */
  search(query: string): Map<string, number> {
    const scores = new Map<string, number>()
    const raw = fold(query)
    if (!raw) return scores

    const queryTerms = contentTerms(query)
    // `contentTerms` drops stopwords and short tokens; if that leaves nothing
    // (searching for "de" or "ok"), fall back to the bare folded token so the
    // user still gets prefix matches rather than an empty screen.
    const terms = queryTerms.length > 0 ? queryTerms : [stem(raw.split(/\s+/)[0] ?? '')]

    const docCount = this.lengths.size
    if (docCount === 0) return scores

    const avgLength = this.totalLength / docCount || 1
    const endsMidWord = !/\s$/.test(query)

    terms.forEach((term, index) => {
      const isLast = index === terms.length - 1
      const buckets =
        isLast && endsMidWord ? this.prefixBuckets(term) : this.exactBuckets(term)

      for (const bucket of buckets) {
        const idf = Math.log(1 + (docCount - bucket.size + 0.5) / (bucket.size + 0.5))

        for (const [docId, posting] of bucket) {
          const docLength = this.lengths.get(docId) ?? 0
          const denominator =
            posting.tf + K1 * (1 - B + (B * docLength) / avgLength)
          const contribution = idf * ((posting.tf * (K1 + 1)) / (denominator || 1))
          scores.set(docId, (scores.get(docId) ?? 0) + contribution)
        }
      }
    })

    return scores
  }

  private exactBuckets(term: string): Array<Map<string, Posting>> {
    const bucket = this.postings.get(term)
    return bucket ? [bucket] : []
  }

  private prefixBuckets(prefix: string): Array<Map<string, Posting>> {
    const exact = this.postings.get(prefix)
    if (exact) return [exact]

    const out: Array<Map<string, Posting>> = []
    for (const [term, bucket] of this.postings) {
      if (term.startsWith(prefix)) out.push(bucket)
      // A prefix that matches half the vocabulary tells us nothing and costs
      // real time; cap the fan-out and let the other query terms discriminate.
      if (out.length >= 64) break
    }
    return out
  }
}
