import type { Locale } from '../i18n'

/** Half-open interval `[from, to)` in epoch ms. */
export interface DateRange {
  from: number
  to: number
}

export type DateOp = 'on' | 'after' | 'before' | 'between'

export type Filter =
  | { kind: 'tag'; value: string; span: Span }
  | { kind: 'mention'; value: string; span: Span }
  | { kind: 'color'; hex: string; label: string; span: Span }
  | { kind: 'system'; value: string; span: Span }
  | { kind: 'phrase'; value: string; span: Span }
  | { kind: 'date'; op: DateOp; range: DateRange; label: string; span: Span }
  | { kind: 'flag'; flag: FlagName; span: Span }

export type FlagName = 'empty' | 'linked' | 'unlinked' | 'pinned'

/** Character offsets into the original query string, `[start, end)`. */
export interface Span {
  start: number
  end: number
}

export interface Chip {
  /** Stable key for React lists; also identifies the chip when dismissed. */
  id: string
  /** Short label shown in the chip, already localized. */
  label: string
  /** Longer form for tooltips / screen readers. */
  detail: string
  kind: Filter['kind']
  span: Span
}

export interface ParsedQuery {
  /** Everything the recognizers did not claim. This is the full-text part. */
  text: string
  filters: Filter[]
  chips: Chip[]
  /** True when the query asks for nothing at all. */
  isEmpty: boolean
}

export interface ParseOptions {
  locale?: Locale
  /** Injectable for deterministic tests. */
  now?: number
  /** 0 = Sunday (pt-BR default), 1 = Monday (en default). */
  weekStartsOn?: 0 | 1
}
