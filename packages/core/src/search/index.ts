export { parseQuery, removeSpan } from './parse'
export { scanDates, formatRangeLabel } from './dates'
export { matchesFilters, EMPTY_CONTEXT, type SearchContext } from './predicate'
export { rankResults, normalizeBm25, type RankInput, type RankedResult, type RankOptions } from './rank'
export { TextIndex, type IndexableNote } from './text-index'
export { searchNotes, resultsBounds, type SearchRequest, type SearchOutcome } from './execute'
export type {
  Chip,
  DateOp,
  DateRange,
  Filter,
  FlagName,
  ParsedQuery,
  ParseOptions,
  Span,
} from './types'
