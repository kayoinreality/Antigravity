import { foldAligned } from '../text/normalize'
import { matchColorName, colorKey } from '../theme/palette'
import { translate, type Locale } from '../i18n'
import { formatRangeLabel, scanDates } from './dates'
import type { Chip, Filter, FlagName, ParseOptions, ParsedQuery, Span } from './types'

/**
 * Turns one free-form query string into structured filters plus leftover text.
 *
 * The design constraint from the product side was "no buttons": the user types
 * `reunião semana passada #tcc` and the app figures out that there is a text
 * term, a date range and a tag — without a filter UI to click through.
 *
 * Mechanically it is a claim-based scanner. Every recognizer proposes character
 * spans against an index-aligned folded copy of the input; the first recognizer
 * to claim a span wins, and whatever nobody claimed becomes the full-text
 * query. Recognizer order below *is* the precedence order.
 *
 * Spans are preserved all the way out to the chips so dismissing a chip can
 * splice that exact substring back out of the raw input (`removeSpan`).
 */

const FLAG_PATTERNS: Array<{ flag: FlagName; pattern: RegExp }> = [
  { flag: 'unlinked', pattern: /\b(?:sem links?|sem conexao|sem conexoes|orfas?|orfaos?|unlinked|orphan(?:ed)?)\b/g },
  { flag: 'linked', pattern: /\b(?:com links?|com conexao|com conexoes|conectadas?|linked|connected)\b/g },
  { flag: 'empty', pattern: /\b(?:vazias?|em branco|empty|blank)\b/g },
  { flag: 'pinned', pattern: /\b(?:fixadas?|fixas?|pinned)\b/g },
]

const QUOTED_RE = /"([^"]+)"|“([^”]+)”/g
const TAG_RE = /#([\p{L}\p{N}_-]{1,40})/gu
const MENTION_RE = /@([\p{L}\p{N}_.-]{1,40})/gu
const KEYVALUE_RE =
  /\b(cor|color|sistema|system|tag|etiqueta)\s*:\s*("([^"]+)"|[\p{L}\p{N}_-]+)/gu

export function parseQuery(input: string, options: ParseOptions = {}): ParsedQuery {
  const locale: Locale = options.locale ?? 'pt'
  const now = options.now ?? Date.now()
  const weekStartsOn = options.weekStartsOn ?? (locale === 'pt' ? 0 : 1)

  const folded = foldAligned(input)
  const claimed: boolean[] = new Array(input.length).fill(false)
  const filters: Filter[] = []

  const claim = (start: number, end: number): boolean => {
    for (let i = start; i < end; i++) if (claimed[i]) return false
    for (let i = start; i < end; i++) claimed[i] = true
    return true
  }

  // 1. Quoted phrases — an explicit "this exact wording" escape hatch, so it
  //    has to run before anything else can nibble at the words inside.
  QUOTED_RE.lastIndex = 0
  for (let m = QUOTED_RE.exec(input); m; m = QUOTED_RE.exec(input)) {
    const value = (m[1] ?? m[2] ?? '').trim()
    if (!value) continue
    const span = { start: m.index, end: m.index + m[0].length }
    if (claim(span.start, span.end)) filters.push({ kind: 'phrase', value, span })
  }

  // 2. key:value — explicit, unambiguous, and can contain words that later
  //    recognizers would otherwise grab (`sistema:março`).
  KEYVALUE_RE.lastIndex = 0
  for (let m = KEYVALUE_RE.exec(input); m; m = KEYVALUE_RE.exec(input)) {
    const key = foldAligned(m[1]!)
    const rawValue = (m[3] ?? m[2] ?? '').trim()
    if (!rawValue) continue
    const span = { start: m.index, end: m.index + m[0].length }

    if (key === 'cor' || key === 'color') {
      const hex = matchColorName(rawValue)
      if (hex && claim(span.start, span.end)) {
        filters.push({ kind: 'color', hex, label: colorKey(hex), span })
      }
      continue
    }
    if (key === 'sistema' || key === 'system') {
      if (claim(span.start, span.end)) {
        filters.push({ kind: 'system', value: rawValue, span })
      }
      continue
    }
    if (claim(span.start, span.end)) {
      filters.push({ kind: 'tag', value: foldAligned(rawValue), span })
    }
  }

  // 3. #tag and @mention.
  TAG_RE.lastIndex = 0
  for (let m = TAG_RE.exec(input); m; m = TAG_RE.exec(input)) {
    const span = { start: m.index, end: m.index + m[0].length }
    if (claim(span.start, span.end)) {
      filters.push({ kind: 'tag', value: foldAligned(m[1]!), span })
    }
  }

  MENTION_RE.lastIndex = 0
  for (let m = MENTION_RE.exec(input); m; m = MENTION_RE.exec(input)) {
    const span = { start: m.index, end: m.index + m[0].length }
    if (claim(span.start, span.end)) {
      filters.push({ kind: 'mention', value: foldAligned(m[1]!), span })
    }
  }

  // 4. Standalone flag phrases. Ordered so "sem links" beats "com links"
  //    beats a bare "links" (see FLAG_PATTERNS).
  for (const { flag, pattern } of FLAG_PATTERNS) {
    pattern.lastIndex = 0
    for (let m = pattern.exec(folded); m; m = pattern.exec(folded)) {
      const span = { start: m.index, end: m.index + m[0].length }
      if (claim(span.start, span.end)) filters.push({ kind: 'flag', flag, span })
    }
  }

  // 5. Dates, last among the recognizers: month names and bare years are the
  //    most likely to collide with real note text, so everything explicit
  //    gets first refusal on those characters.
  for (const match of scanDates(folded, claimed, { now, weekStartsOn, locale })) {
    filters.push({
      kind: 'date',
      op: match.op,
      range: match.range,
      label: formatRangeLabel(match.op, match.range, locale),
      span: match.span,
    })
  }

  // 6. Whatever survived is the full-text query.
  let text = ''
  for (let i = 0; i < input.length; i++) {
    text += claimed[i] ? ' ' : input[i]
  }
  text = text.replace(/\s+/g, ' ').trim()

  filters.sort((a, b) => a.span.start - b.span.start)

  return {
    text,
    filters,
    chips: filters.map((f) => toChip(f, locale, input)),
    isEmpty: text.length === 0 && filters.length === 0,
  }
}

function toChip(filter: Filter, locale: Locale, input: string): Chip {
  const id = `${filter.kind}:${filter.span.start}-${filter.span.end}`
  const raw = input.slice(filter.span.start, filter.span.end).trim()

  switch (filter.kind) {
    case 'tag':
      return { id, kind: filter.kind, span: filter.span, label: `#${filter.value}`, detail: `${translate(locale, 'filter.tag')}: ${filter.value}` }
    case 'mention':
      return { id, kind: filter.kind, span: filter.span, label: `@${filter.value}`, detail: `@${filter.value}` }
    case 'color':
      return { id, kind: filter.kind, span: filter.span, label: raw, detail: `${translate(locale, 'filter.color')}: ${filter.label}` }
    case 'system':
      return { id, kind: filter.kind, span: filter.span, label: `☉ ${filter.value}`, detail: `${translate(locale, 'filter.system')}: ${filter.value}` }
    case 'phrase':
      return { id, kind: filter.kind, span: filter.span, label: `"${filter.value}"`, detail: `${translate(locale, 'filter.text')}: ${filter.value}` }
    case 'date':
      return { id, kind: filter.kind, span: filter.span, label: raw, detail: filter.label }
    case 'flag':
      return { id, kind: filter.kind, span: filter.span, label: raw, detail: translate(locale, FLAG_MESSAGE[filter.flag]) }
  }
}

const FLAG_MESSAGE = {
  empty: 'filter.empty',
  linked: 'filter.linked',
  unlinked: 'filter.unlinked',
  pinned: 'filter.pinned',
} as const

/**
 * Cuts a chip's span out of the raw query. This is what makes the chips feel
 * like real controls: dismissing one edits the text the user actually sees,
 * instead of holding hidden state beside it.
 */
export function removeSpan(input: string, span: Span): string {
  return (input.slice(0, span.start) + input.slice(span.end)).replace(/\s+/g, ' ').trim()
}
