import { extractTags } from '../model/note'
import { foldAligned } from '../text/normalize'
import type { Note } from '../model/types'
import type { Filter } from './types'

/**
 * Structural filter evaluation, shared so web and mobile can never disagree
 * about what "sem link" means.
 *
 * The mobile store pushes the cheap, indexed predicates (date, colour, system,
 * pinned) down into SQL and then calls this with only the leftovers; the web
 * store passes every filter. Both paths run the same code for the same kind of
 * filter, which is the point.
 */

export interface SearchContext {
  /** Number of live links touching a note, in either direction. */
  linkCount: (noteId: string) => number
  /** Display label of a system, used so `sistema:tcc` can match by name. */
  systemLabel: (systemId: string) => string | null
}

export const EMPTY_CONTEXT: SearchContext = {
  linkCount: () => 0,
  systemLabel: () => null,
}

function matchesOne(note: Note, filter: Filter, ctx: SearchContext): boolean {
  switch (filter.kind) {
    case 'tag':
      return extractTags(note).includes(filter.value)

    case 'mention':
      return foldAligned(`${note.title}\n${note.content}`).includes(`@${filter.value}`)

    case 'color':
      return note.color.toLowerCase() === filter.hex.toLowerCase()

    case 'system': {
      if (!note.systemId) return false
      const wanted = foldAligned(filter.value)
      if (foldAligned(note.systemId) === wanted) return true
      const label = ctx.systemLabel(note.systemId)
      return label !== null && foldAligned(label).includes(wanted)
    }

    case 'phrase':
      return foldAligned(`${note.title}\n${note.content}`).includes(foldAligned(filter.value))

    case 'date':
      // `updatedAt` rather than `createdAt`: "notas de ontem" means notes the
      // user touched yesterday, which is what they are trying to get back to.
      return note.updatedAt >= filter.range.from && note.updatedAt < filter.range.to

    case 'flag':
      switch (filter.flag) {
        case 'empty':
          return note.title.trim() === '' && note.content.trim() === ''
        case 'linked':
          return ctx.linkCount(note.id) > 0
        case 'unlinked':
          return ctx.linkCount(note.id) === 0
        case 'pinned':
          return note.pinned
      }
  }
}

/** All filters must hold (AND). Multiple filters of the same kind narrow. */
export function matchesFilters(
  note: Note,
  filters: Filter[],
  ctx: SearchContext = EMPTY_CONTEXT,
): boolean {
  for (const filter of filters) {
    if (!matchesOne(note, filter, ctx)) return false
  }
  return true
}
