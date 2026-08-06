import { describe, expect, it } from 'vitest'
import { parseQuery, removeSpan } from './parse'
import type { Filter } from './types'

/**
 * The parser is the feature: the product requirement was that a user types one
 * line and the app works out what they meant, with no filter buttons. These
 * tests are the specification of "what they meant".
 *
 * NOW is a Wednesday, so week-relative expressions have a non-trivial answer
 * under both Sunday-start (pt) and Monday-start (en) weeks.
 */
const NOW = new Date(2026, 2, 18, 15, 30).getTime() // Wed 18 Mar 2026, local time

const parse = (query: string, locale: 'pt' | 'en' = 'pt') =>
  parseQuery(query, { now: NOW, locale })

const kinds = (filters: Filter[]): string[] => filters.map((f) => f.kind)

const dateFilter = (query: string, locale: 'pt' | 'en' = 'pt') => {
  const filter = parse(query, locale).filters.find((f) => f.kind === 'date')
  if (!filter || filter.kind !== 'date') throw new Error(`no date filter in "${query}"`)
  return filter
}

const day = (y: number, m: number, d: number) => new Date(y, m, d).getTime()

describe('free text', () => {
  it('passes plain words through untouched', () => {
    const parsed = parse('ideias para o projeto')
    expect(parsed.text).toBe('ideias para o projeto')
    expect(parsed.filters).toHaveLength(0)
    expect(parsed.isEmpty).toBe(false)
  })

  it('reports an empty query as empty', () => {
    expect(parse('').isEmpty).toBe(true)
    expect(parse('   ').isEmpty).toBe(true)
  })
})

describe('tags and mentions', () => {
  it('extracts #tags and leaves the rest as text', () => {
    const parsed = parse('reunião #tcc')
    expect(parsed.text).toBe('reunião')
    expect(kinds(parsed.filters)).toEqual(['tag'])
    expect(parsed.filters[0]).toMatchObject({ kind: 'tag', value: 'tcc' })
  })

  it('folds accents in tags so #tcc matches #TCC and #análise matches #analise', () => {
    expect(parse('#Análise').filters[0]).toMatchObject({ value: 'analise' })
  })

  it('extracts @mentions', () => {
    const parsed = parse('almoço @maria')
    expect(parsed.text).toBe('almoço')
    expect(parsed.filters[0]).toMatchObject({ kind: 'mention', value: 'maria' })
  })

  it('supports several tags at once', () => {
    expect(kinds(parse('#tcc #faculdade').filters)).toEqual(['tag', 'tag'])
  })
})

describe('key:value filters', () => {
  it('resolves Portuguese colour names', () => {
    expect(parse('cor:amarelo').filters[0]).toMatchObject({ kind: 'color', hex: '#FFD966' })
  })

  it('resolves English colour names', () => {
    expect(parse('color:purple', 'en').filters[0]).toMatchObject({ kind: 'color', hex: '#C4A2FF' })
  })

  it('leaves an unknown colour as free text rather than silently dropping it', () => {
    const parsed = parse('cor:banana')
    expect(parsed.filters).toHaveLength(0)
    expect(parsed.text).toBe('cor:banana')
  })

  it('captures system filters', () => {
    expect(parse('sistema:faculdade').filters[0]).toMatchObject({
      kind: 'system',
      value: 'faculdade',
    })
  })

  it('shields a key:value from later recognizers', () => {
    // "março" would otherwise be read as a date.
    const parsed = parse('sistema:março')
    expect(kinds(parsed.filters)).toEqual(['system'])
  })
})

describe('quoted phrases', () => {
  it('keeps the phrase intact and out of the text bucket', () => {
    const parsed = parse('"entrega final" #tcc')
    expect(parsed.filters[0]).toMatchObject({ kind: 'phrase', value: 'entrega final' })
    expect(parsed.text).toBe('')
  })

  it('protects date words inside quotes', () => {
    const parsed = parse('"reunião de ontem"')
    expect(kinds(parsed.filters)).toEqual(['phrase'])
  })
})

describe('flag phrases', () => {
  it.each([
    ['vazias', 'empty'],
    ['em branco', 'empty'],
    ['com link', 'linked'],
    ['sem link', 'unlinked'],
    ['sem links', 'unlinked'],
    ['órfãs', 'unlinked'],
    ['fixadas', 'pinned'],
  ])('reads "%s" as the %s flag', (input, flag) => {
    expect(parse(input).filters[0]).toMatchObject({ kind: 'flag', flag })
  })

  it.each([
    ['empty', 'empty'],
    ['linked', 'linked'],
    ['unlinked', 'unlinked'],
    ['pinned', 'pinned'],
  ])('reads English "%s" as the %s flag', (input, flag) => {
    expect(parse(input, 'en').filters[0]).toMatchObject({ kind: 'flag', flag })
  })

  it('prefers "sem link" over "com link" when both could match a substring', () => {
    expect(parse('sem links').filters[0]).toMatchObject({ flag: 'unlinked' })
  })
})

describe('relative dates in Portuguese', () => {
  it('reads "hoje" as today', () => {
    const filter = dateFilter('hoje')
    expect(filter.range.from).toBe(day(2026, 2, 18))
    expect(filter.range.to).toBe(day(2026, 2, 19))
  })

  it('reads "ontem" as yesterday', () => {
    expect(dateFilter('ontem').range.from).toBe(day(2026, 2, 17))
  })

  it('reads "anteontem" as two days back, beating a bare "ontem"', () => {
    const filter = dateFilter('anteontem')
    expect(filter.range.from).toBe(day(2026, 2, 16))
    expect(filter.range.to).toBe(day(2026, 2, 17))
  })

  it('reads "semana passada" as the previous Sunday-start week', () => {
    const filter = dateFilter('semana passada')
    expect(filter.range.from).toBe(day(2026, 2, 8)) // Sun 8 Mar
    expect(filter.range.to).toBe(day(2026, 2, 15)) // Sun 15 Mar
  })

  it('reads "essa semana" as the current week', () => {
    expect(dateFilter('essa semana').range.from).toBe(day(2026, 2, 15))
  })

  it('reads "mês passado" as all of February', () => {
    const filter = dateFilter('mês passado')
    expect(filter.range.from).toBe(day(2026, 1, 1))
    expect(filter.range.to).toBe(day(2026, 2, 1))
  })

  it('reads "ano passado" as all of 2025', () => {
    const filter = dateFilter('ano passado')
    expect(filter.range.from).toBe(day(2025, 0, 1))
    expect(filter.range.to).toBe(day(2026, 0, 1))
  })

  it('reads "últimos 7 dias" as a 7-day window ending today', () => {
    const filter = dateFilter('últimos 7 dias')
    expect(filter.range.from).toBe(day(2026, 2, 12))
    expect(filter.range.to).toBe(day(2026, 2, 19))
  })

  it('reads "nos últimos 3 meses"', () => {
    expect(dateFilter('nos últimos 3 meses').range.from).toBe(day(2025, 11, 18))
  })

  it('reads a bare year as that whole year', () => {
    const filter = dateFilter('2024')
    expect(filter.range.from).toBe(day(2024, 0, 1))
    expect(filter.range.to).toBe(day(2025, 0, 1))
  })
})

describe('relative dates in English', () => {
  it('uses Monday-start weeks for "last week"', () => {
    const filter = dateFilter('last week', 'en')
    expect(filter.range.from).toBe(day(2026, 2, 9)) // Mon 9 Mar
    expect(filter.range.to).toBe(day(2026, 2, 16))
  })

  it.each([
    ['today', day(2026, 2, 18)],
    ['yesterday', day(2026, 2, 17)],
    ['this month', day(2026, 2, 1)],
  ])('reads "%s"', (input, expected) => {
    expect(dateFilter(input, 'en').range.from).toBe(expected)
  })
})

describe('absolute dates', () => {
  it('reads dd/mm as day-first', () => {
    const filter = dateFilter('12/03')
    expect(filter.range.from).toBe(day(2026, 2, 12))
  })

  it('reads dd/mm/yyyy', () => {
    expect(dateFilter('12/03/2024').range.from).toBe(day(2024, 2, 12))
  })

  it('expands a two-digit year', () => {
    expect(dateFilter('01/02/25').range.from).toBe(day(2025, 1, 1))
  })

  it('ignores an impossible date instead of rolling it over into March', () => {
    const parsed = parse('31/02/2025')
    expect(parsed.filters.filter((f) => f.kind === 'date')).toHaveLength(0)
  })

  it('reads a month name as the whole month', () => {
    const filter = dateFilter('em março')
    expect(filter.range.from).toBe(day(2026, 2, 1))
    expect(filter.range.to).toBe(day(2026, 3, 1))
  })

  it('reads "3 de março" as a single day', () => {
    const filter = dateFilter('3 de março')
    expect(filter.range.from).toBe(day(2026, 2, 3))
    expect(filter.range.to).toBe(day(2026, 2, 4))
  })

  it('reads "march 3" in English', () => {
    expect(dateFilter('march 3', 'en').range.from).toBe(day(2026, 2, 3))
  })

  it('honours an explicit year after a month name', () => {
    expect(dateFilter('março de 2024').range.from).toBe(day(2024, 2, 1))
  })
})

describe('date operators', () => {
  it('turns "desde ontem" into an open-ended lower bound', () => {
    const filter = dateFilter('desde ontem')
    expect(filter.op).toBe('after')
    expect(filter.range.from).toBe(day(2026, 2, 17))
    expect(filter.range.to).toBe(Number.POSITIVE_INFINITY)
  })

  it('turns "antes de junho" into an upper bound', () => {
    const filter = dateFilter('antes de junho')
    expect(filter.op).toBe('before')
    expect(filter.range.from).toBe(Number.NEGATIVE_INFINITY)
    expect(filter.range.to).toBe(day(2026, 5, 1))
  })

  it('absorbs the operator word into the chip span', () => {
    const parsed = parse('desde ontem')
    expect(parsed.text).toBe('')
    expect(parsed.chips[0]!.label).toBe('desde ontem')
  })

  it('reads English "since"', () => {
    expect(dateFilter('since yesterday', 'en').op).toBe('after')
  })
})

describe('mixed queries', () => {
  it('splits "reunião semana passada #tcc" into text, date and tag', () => {
    const parsed = parse('reunião semana passada #tcc')
    expect(parsed.text).toBe('reunião')
    expect(kinds(parsed.filters).sort()).toEqual(['date', 'tag'])
  })

  it('handles text plus colour plus flag', () => {
    const parsed = parse('projeto cor:azul fixadas')
    expect(parsed.text).toBe('projeto')
    expect(kinds(parsed.filters).sort()).toEqual(['color', 'flag'])
  })

  it('keeps unrelated words when several recognizers fire', () => {
    const parsed = parse('entregar relatório até 30/04 #trabalho @ana')
    expect(parsed.text).toBe('entregar relatório')
    expect(kinds(parsed.filters).sort()).toEqual(['date', 'mention', 'tag'])
  })

  it('orders chips by their position in the query', () => {
    const parsed = parse('#a ontem #b')
    expect(parsed.chips.map((c) => c.label)).toEqual(['#a', 'ontem', '#b'])
  })
})

describe('chip spans', () => {
  it('points at the exact substring it consumed', () => {
    const query = 'reunião semana passada'
    const parsed = parse(query)
    const chip = parsed.chips.find((c) => c.kind === 'date')!
    expect(query.slice(chip.span.start, chip.span.end)).toBe('semana passada')
  })

  it('survives accented characters without drifting', () => {
    const query = 'análise órfãs'
    const parsed = parse(query)
    const chip = parsed.chips[0]!
    expect(query.slice(chip.span.start, chip.span.end)).toBe('órfãs')
  })

  it('removeSpan cuts the filter back out of the raw query', () => {
    const query = 'reunião semana passada #tcc'
    const parsed = parse(query)
    const chip = parsed.chips.find((c) => c.kind === 'date')!
    expect(removeSpan(query, chip.span)).toBe('reunião #tcc')
  })

  it('spans never overlap', () => {
    const parsed = parse('projeto #tcc cor:azul ontem @ana "prazo final"')
    const spans = [...parsed.filters].sort((a, b) => a.span.start - b.span.start)
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.span.start).toBeGreaterThanOrEqual(spans[i - 1]!.span.end)
    }
  })
})
