import { parseQuery } from './parse'
import { matchesFilters, EMPTY_CONTEXT, type SearchContext } from './predicate'
import { rankResults, type RankedResult } from './rank'
import type { TextIndex } from './text-index'
import type { ParsedQuery, ParseOptions } from './types'
import type { Note } from '../model/types'

/**
 * End-to-end in-memory search: parse, filter, score, rank.
 *
 * This is the whole pipeline for the web app and the reference implementation
 * the tests exercise. Mobile swaps the middle two steps for SQL against FTS5
 * but calls the same `parseQuery` and `rankResults`, so the two agree on what a
 * query means and on the order it comes back in.
 */

export interface SearchRequest extends ParseOptions {
  query: string
  /** Live notes only — tombstones must be filtered out before this point. */
  notes: Note[]
  index: TextIndex
  context?: SearchContext
  /** System the canvas is currently focused on, if any. */
  activeSystemId?: string | null
}

export interface SearchOutcome {
  parsed: ParsedQuery
  results: RankedResult[]
  /** Convenience for the canvas spotlight, which asks per note. */
  matched: Set<string>
}

export function searchNotes(request: SearchRequest): SearchOutcome {
  const { query, notes, index, context = EMPTY_CONTEXT, activeSystemId = null } = request
  const parsed = parseQuery(query, request)

  if (parsed.isEmpty) {
    return { parsed, results: [], matched: new Set() }
  }

  const textScores = parsed.text ? index.search(parsed.text) : null

  const candidates = notes.filter((note) => {
    if (note.deletedAt !== null) return false
    if (textScores && !textScores.has(note.id)) return false
    return matchesFilters(note, parsed.filters, context)
  })

  const results = rankResults(
    candidates.map((note) => ({
      noteId: note.id,
      textScore: textScores?.get(note.id) ?? 0,
      updatedAt: note.updatedAt,
      pinned: note.pinned,
      inActiveSystem: activeSystemId !== null && note.systemId === activeSystemId,
    })),
    { now: request.now, hasTextQuery: parsed.text.length > 0 },
  )

  return { parsed, results, matched: new Set(results.map((r) => r.noteId)) }
}

/** Bounding box of a result set, so the camera can frame every match at once. */
export function resultsBounds(
  results: RankedResult[],
  noteById: Map<string, Note>,
  noteWidth: number,
  noteHeight: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let found = false

  for (const result of results) {
    const note = noteById.get(result.noteId)
    if (!note) continue
    found = true
    if (note.x < minX) minX = note.x
    if (note.y < minY) minY = note.y
    if (note.x + noteWidth > maxX) maxX = note.x + noteWidth
    if (note.y + noteHeight > maxY) maxY = note.y + noteHeight
  }

  return found ? { minX, minY, maxX, maxY } : null
}
