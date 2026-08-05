import type { DateOp, DateRange, Span } from './types'
import type { Locale } from '../i18n'

/**
 * Date recognition for the single search field.
 *
 * Two layers, in this order:
 *  1. A phrase table for the relative expressions people actually type
 *     ("semana passada", "últimos 7 dias"). These are handled here rather than
 *     by chrono because chrono's pt locale misses several of them and because
 *     we need exact character spans to build dismissible chips.
 *  2. `chrono-node` for everything absolute — "12/03/2025", "março", "March 3".
 *
 * Ranges are half-open `[from, to)` so "hoje" and "ontem" never overlap.
 */

const DAY = 86_400_000

export interface DateMatch {
  op: DateOp
  range: DateRange
  /** Localized human label for the chip, e.g. "semana passada". */
  label: string
  span: Span
}

const startOfDay = (ts: number): number => {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const addDays = (ts: number, days: number): number => {
  const d = new Date(ts)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

const addMonths = (ts: number, months: number): number => {
  const d = new Date(ts)
  d.setMonth(d.getMonth() + months)
  return d.getTime()
}

const startOfWeek = (ts: number, weekStartsOn: 0 | 1): number => {
  const d = new Date(startOfDay(ts))
  const diff = (d.getDay() - weekStartsOn + 7) % 7
  d.setDate(d.getDate() - diff)
  return d.getTime()
}

const startOfMonth = (ts: number): number => {
  const d = new Date(startOfDay(ts))
  d.setDate(1)
  return d.getTime()
}

const startOfYear = (ts: number): number => {
  const d = new Date(startOfDay(ts))
  d.setMonth(0, 1)
  return d.getTime()
}

interface PhraseRule {
  /** Matched against the accent-folded, lowercased query. */
  pattern: RegExp
  build: (ctx: Ctx, m: RegExpExecArray) => DateRange
}

interface Ctx {
  now: number
  weekStartsOn: 0 | 1
}

/**
 * Ordered longest-phrase-first. `parseDatePhrases` walks these in order and
 * skips anything already consumed, so "semana passada" wins over a bare
 * "semana" and "antes de ontem" wins over "ontem".
 */
const PHRASE_RULES: PhraseRule[] = [
  // --- day granularity -----------------------------------------------------
  {
    pattern: /\b(?:antes de ontem|anteontem|day before yesterday)\b/g,
    build: ({ now }) => {
      const from = addDays(startOfDay(now), -2)
      return { from, to: from + DAY }
    },
  },
  {
    pattern: /\b(?:ontem|yesterday)\b/g,
    build: ({ now }) => {
      const from = addDays(startOfDay(now), -1)
      return { from, to: from + DAY }
    },
  },
  {
    pattern: /\b(?:hoje|today)\b/g,
    build: ({ now }) => {
      const from = startOfDay(now)
      return { from, to: from + DAY }
    },
  },
  {
    pattern: /\b(?:amanha|tomorrow)\b/g,
    build: ({ now }) => {
      const from = addDays(startOfDay(now), 1)
      return { from, to: from + DAY }
    },
  },

  // --- "last N <unit>" -----------------------------------------------------
  {
    pattern:
      /\b(?:(?:nos|nas)\s+)?(?:ultimos|ultimas|past|last)\s+(\d{1,3})\s+(dias|dia|days|day|semanas|semana|weeks|week|meses|mes|months|month)\b/g,
    build: ({ now }, m) => {
      const n = Number.parseInt(m[1]!, 10)
      const unit = m[2]!
      const today = startOfDay(now)
      const to = today + DAY
      if (/^(semanas?|weeks?)$/.test(unit)) return { from: addDays(today, -7 * n + 1), to }
      if (/^(mes|meses|months?)$/.test(unit)) return { from: addMonths(today, -n), to }
      return { from: addDays(today, -n + 1), to }
    },
  },

  // --- week ----------------------------------------------------------------
  {
    pattern: /\b(?:semana passada|ultima semana|last week)\b/g,
    build: ({ now, weekStartsOn }) => {
      const thisWeek = startOfWeek(now, weekStartsOn)
      return { from: addDays(thisWeek, -7), to: thisWeek }
    },
  },
  {
    pattern: /\b(?:(?:esta|essa|nesta|nessa) semana|this week)\b/g,
    build: ({ now, weekStartsOn }) => {
      const from = startOfWeek(now, weekStartsOn)
      return { from, to: addDays(from, 7) }
    },
  },

  // --- month ---------------------------------------------------------------
  {
    pattern: /\b(?:mes passado|ultimo mes|last month)\b/g,
    build: ({ now }) => {
      const thisMonth = startOfMonth(now)
      return { from: addMonths(thisMonth, -1), to: thisMonth }
    },
  },
  {
    pattern: /\b(?:(?:este|esse|neste|nesse) mes|this month)\b/g,
    build: ({ now }) => {
      const from = startOfMonth(now)
      return { from, to: addMonths(from, 1) }
    },
  },

  // --- year ----------------------------------------------------------------
  {
    pattern: /\b(?:ano passado|ultimo ano|last year)\b/g,
    build: ({ now }) => {
      const thisYear = startOfYear(now)
      const d = new Date(thisYear)
      d.setFullYear(d.getFullYear() - 1)
      return { from: d.getTime(), to: thisYear }
    },
  },
  {
    pattern: /\b(?:(?:este|esse|neste|nesse) ano|this year)\b/g,
    build: ({ now }) => {
      const from = startOfYear(now)
      const d = new Date(from)
      d.setFullYear(d.getFullYear() + 1)
      return { from, to: d.getTime() }
    },
  },

]

/**
 * Bare years run last, after numeric dates and month names. `\b` treats "/" as
 * a boundary, so a year-first rule would happily claim the "2025" out of
 * "31/02/2025" and leave the rest stranded.
 */
const BARE_YEAR_RE = /(19\d{2}|20\d{2})/g

/** True when the match is a standalone year, not part of a longer date token. */
const isStandaloneYear = (folded: string, start: number, end: number): boolean => {
  const before = start > 0 ? folded[start - 1]! : ' '
  const after = end < folded.length ? folded[end]! : ' '
  return !/[\d/.-]/.test(before) && !/[\d/.-]/.test(after)
}

const MONTHS: Record<string, number> = {
  janeiro: 0, jan: 0, january: 0,
  fevereiro: 1, fev: 1, february: 1, feb: 1,
  marco: 2, mar: 2, march: 2,
  abril: 3, abr: 3, april: 3, apr: 3,
  maio: 4, mai: 4, may: 4,
  junho: 5, jun: 5, june: 5,
  julho: 6, jul: 6, july: 6,
  agosto: 7, ago: 7, august: 7, aug: 7,
  setembro: 8, set: 8, september: 8, sep: 8, sept: 8,
  outubro: 9, out: 9, october: 9, oct: 9,
  novembro: 10, nov: 10, november: 10,
  dezembro: 11, dez: 11, december: 11, dec: 11,
}

const MONTH_NAMES = Object.keys(MONTHS).join('|')

/**
 * Covers "março", "em março de 2024", "3 de março", "12 de mar 2025" and the
 * English "march", "march 3", "in march 2024". The day group is optional; when
 * present the range narrows from the whole month to that single day.
 */
/**
 * Note the absence of a bare `de\s+` in the leading group: it would swallow the
 * "de" of "antes de junho", and the operator look-behind would then never see
 * the phrase it needs to turn the match into an upper bound.
 */
const MONTH_RE = new RegExp(
  '\\b(?:em\\s+|in\\s+|no\\s+)?' +
    `(?:(\\d{1,2})\\s+de\\s+)?(${MONTH_NAMES})` +
    '(?:\\s+(\\d{1,2})(?![/.\\-\\d]))?' +
    '(?:\\s+(?:de\\s+)?(\\d{4}))?\\b',
  'g',
)

/** dd/mm or dd/mm/yyyy — day-first, which is the Brazilian convention. */
const NUMERIC_DATE_RE = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/g

/**
 * Operator words that flip a date match from "on" to a bound. Captured with
 * the date so dismissing the chip removes "desde ontem", not just "ontem".
 */
const OP_PREFIX_RE =
  /(?:\b(desde|apos|apos o|depois de|depois do|depois da|after|since|from)\s+)|(?:\b(antes de|antes do|antes da|ate|ate o|before|until|till)\s+)/

export interface PhraseScanOptions {
  now: number
  weekStartsOn: 0 | 1
  locale: Locale
}

/**
 * Scans `folded` (accent-folded lowercase text, same length as the original)
 * and returns matches whose spans index into the original string.
 *
 * `claimed` is mutated: characters covered by an accepted match are marked so
 * later recognizers and the free-text pass skip them.
 */
export function scanDates(
  folded: string,
  claimed: boolean[],
  opts: PhraseScanOptions,
): DateMatch[] {
  const ctx: Ctx = { now: opts.now, weekStartsOn: opts.weekStartsOn }
  const matches: DateMatch[] = []

  const tryClaim = (start: number, end: number): boolean => {
    for (let i = start; i < end; i++) if (claimed[i]) return false
    for (let i = start; i < end; i++) claimed[i] = true
    return true
  }

  const push = (start: number, end: number, range: DateRange): void => {
    // Look behind for "desde"/"antes de" and absorb it into the span.
    const before = folded.slice(Math.max(0, start - 14), start)
    const opMatch = OP_PREFIX_RE.exec(before)
    let op: DateOp = 'on'
    let realStart = start

    if (opMatch && opMatch.index + opMatch[0].length === before.length) {
      realStart = start - opMatch[0].length
      op = opMatch[1] ? 'after' : 'before'
    }

    if (!tryClaim(realStart, end)) return

    // "desde ontem" means from the start of yesterday onwards; "antes de
    // junho" means everything before June starts.
    const bounded: DateRange =
      op === 'after'
        ? { from: range.from, to: Number.POSITIVE_INFINITY }
        : op === 'before'
          ? { from: Number.NEGATIVE_INFINITY, to: range.from }
          : range

    matches.push({
      op,
      range: bounded,
      label: folded.slice(realStart, end).trim(),
      span: { start: realStart, end },
    })
  }

  for (const rule of PHRASE_RULES) {
    rule.pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rule.pattern.exec(folded)) !== null) {
      push(m.index, m.index + m[0].length, rule.build(ctx, m))
    }
  }

  NUMERIC_DATE_RE.lastIndex = 0
  let dm: RegExpExecArray | null
  while ((dm = NUMERIC_DATE_RE.exec(folded)) !== null) {
    const day = Number.parseInt(dm[1]!, 10)
    const month = Number.parseInt(dm[2]!, 10) - 1
    if (day < 1 || day > 31 || month < 0 || month > 11) continue

    const rawYear = dm[3]
    const year = rawYear
      ? rawYear.length === 2
        ? 2000 + Number.parseInt(rawYear, 10)
        : Number.parseInt(rawYear, 10)
      : new Date(opts.now).getFullYear()

    const from = new Date(year, month, day).getTime()
    // Reject impossible dates like 31/02 rather than silently rolling over.
    if (new Date(from).getMonth() !== month) continue

    push(dm.index, dm.index + dm[0].length, { from, to: from + DAY })
  }

  MONTH_RE.lastIndex = 0
  let mm: RegExpExecArray | null
  while ((mm = MONTH_RE.exec(folded)) !== null) {
    const month = MONTHS[mm[2]!]!
    const day = mm[1] ?? mm[3]
    const year = mm[4] ? Number.parseInt(mm[4], 10) : new Date(opts.now).getFullYear()

    if (day === undefined) {
      const from = new Date(year, month, 1).getTime()
      push(mm.index, mm.index + mm[0].length, { from, to: addMonths(from, 1) })
      continue
    }

    const dayNum = Number.parseInt(day, 10)
    const from = new Date(year, month, dayNum).getTime()
    if (dayNum < 1 || new Date(from).getMonth() !== month) continue
    push(mm.index, mm.index + mm[0].length, { from, to: from + DAY })
  }

  BARE_YEAR_RE.lastIndex = 0
  let ym: RegExpExecArray | null
  while ((ym = BARE_YEAR_RE.exec(folded)) !== null) {
    const start = ym.index
    const end = start + ym[0].length
    if (!isStandaloneYear(folded, start, end)) continue
    const year = Number.parseInt(ym[1]!, 10)
    push(start, end, {
      from: new Date(year, 0, 1).getTime(),
      to: new Date(year + 1, 0, 1).getTime(),
    })
  }

  return matches.sort((a, b) => a.span.start - b.span.start)
}

export function formatRangeLabel(op: DateOp, range: DateRange, locale: Locale): string {
  const fmt = (ts: number): string =>
    new Date(ts).toLocaleDateString(locale === 'pt' ? 'pt-BR' : 'en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })

  if (op === 'after') return `${locale === 'pt' ? 'depois de' : 'after'} ${fmt(range.from)}`
  if (op === 'before') return `${locale === 'pt' ? 'antes de' : 'before'} ${fmt(range.to)}`
  if (range.to - range.from <= DAY) return fmt(range.from)
  return `${fmt(range.from)} – ${fmt(range.to - 1)}`
}
