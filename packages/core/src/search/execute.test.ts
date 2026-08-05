import { beforeEach, describe, expect, it } from 'vitest'
import { searchNotes } from './execute'
import { TextIndex } from './text-index'
import { rankResults } from './rank'
import { createNote } from '../model/note'
import type { Note } from '../model/types'

const NOW = new Date(2026, 2, 18, 12, 0).getTime()
const DAY = 86_400_000

function note(overrides: Partial<Note> & { title: string }): Note {
  const base = createNote({ title: overrides.title }, NOW)
  return { ...base, ...overrides }
}

describe('TextIndex', () => {
  let index: TextIndex

  beforeEach(() => {
    index = new TextIndex()
    index.add({ id: 'a', title: 'Reunião do TCC', content: 'discutir a metodologia', tags: [] })
    index.add({ id: 'b', title: 'Lista de compras', content: 'arroz feijão café', tags: [] })
    index.add({ id: 'c', title: 'Metodologia', content: 'referências para o TCC', tags: ['tcc'] })
  })

  it('finds notes by a body word', () => {
    expect([...index.search('feijão ').keys()]).toEqual(['b'])
  })

  it('ranks a title match above a body match for the same term', () => {
    const scores = index.search('metodologia ')
    expect(scores.get('c')).toBeGreaterThan(scores.get('a')!)
  })

  it('matches accent-insensitively in both directions', () => {
    expect([...index.search('reuniao ').keys()]).toEqual(['a'])
    expect([...index.search('cafe ').keys()]).toEqual(['b'])
  })

  it('prefix-matches the final word so results appear while typing', () => {
    expect([...index.search('metod').keys()].sort()).toEqual(['a', 'c'])
  })

  it('does not prefix-match once the word is finished', () => {
    expect(index.search('metod ').size).toBe(0)
  })

  it('drops a note from the index when removed', () => {
    index.remove('b')
    expect(index.search('feijão ').size).toBe(0)
    expect(index.size).toBe(2)
  })

  it('re-adding replaces rather than duplicating', () => {
    index.add({ id: 'b', title: 'Lista nova', content: 'pão', tags: [] })
    expect(index.search('feijão ').size).toBe(0)
    expect([...index.search('pão ').keys()]).toEqual(['b'])
    expect(index.size).toBe(3)
  })
})

describe('rankResults', () => {
  it('leads with recency when the query has no text part', () => {
    const ranked = rankResults(
      [
        { noteId: 'old', textScore: 0, updatedAt: NOW - 90 * DAY, pinned: false, inActiveSystem: false },
        { noteId: 'new', textScore: 0, updatedAt: NOW - DAY, pinned: false, inActiveSystem: false },
      ],
      { now: NOW, hasTextQuery: false },
    )
    expect(ranked[0]!.noteId).toBe('new')
  })

  it('lets a much stronger text match outrank a fresher note', () => {
    const ranked = rankResults(
      [
        { noteId: 'relevant', textScore: 10, updatedAt: NOW - 200 * DAY, pinned: false, inActiveSystem: false },
        { noteId: 'fresh', textScore: 1, updatedAt: NOW, pinned: false, inActiveSystem: false },
      ],
      { now: NOW, hasTextQuery: true },
    )
    expect(ranked[0]!.noteId).toBe('relevant')
  })

  it('breaks exact ties deterministically instead of by input order', () => {
    const inputs = [
      { noteId: 'b', textScore: 1, updatedAt: NOW, pinned: false, inActiveSystem: false },
      { noteId: 'a', textScore: 1, updatedAt: NOW, pinned: false, inActiveSystem: false },
    ]
    expect(rankResults(inputs, { now: NOW, hasTextQuery: true })[0]!.noteId).toBe('a')
    expect(rankResults([...inputs].reverse(), { now: NOW, hasTextQuery: true })[0]!.noteId).toBe('a')
  })

  it('assigns dense ranks starting at zero', () => {
    const ranked = rankResults(
      ['x', 'y', 'z'].map((noteId, i) => ({
        noteId,
        textScore: 3 - i,
        updatedAt: NOW,
        pinned: false,
        inActiveSystem: false,
      })),
      { now: NOW, hasTextQuery: true },
    )
    expect(ranked.map((r) => r.rank)).toEqual([0, 1, 2])
  })
})

describe('searchNotes', () => {
  const notes: Note[] = [
    note({ id: 'tcc-meeting', title: 'Reunião do TCC', content: 'metodologia #tcc', updatedAt: NOW - DAY }),
    note({ id: 'groceries', title: 'Compras', content: 'arroz feijão', updatedAt: NOW - 10 * DAY, color: '#6FB4FF' }),
    note({ id: 'old-tcc', title: 'TCC antigo', content: 'rascunho #tcc', updatedAt: NOW - 200 * DAY }),
    note({ id: 'blank', title: '', content: '', updatedAt: NOW - 2 * DAY }),
    note({ id: 'trashed', title: 'TCC descartado', content: '#tcc', updatedAt: NOW, deletedAt: NOW }),
  ]

  const index = new TextIndex()
  for (const n of notes) {
    if (n.deletedAt === null) index.add({ id: n.id, title: n.title, content: n.content, tags: n.tags })
  }

  const run = (query: string) => searchNotes({ query, notes, index, now: NOW, locale: 'pt' })

  it('returns nothing for an empty query rather than everything', () => {
    expect(run('').results).toHaveLength(0)
    expect(run('').parsed.isEmpty).toBe(true)
  })

  it('never returns a deleted note', () => {
    expect(run('#tcc').matched.has('trashed')).toBe(false)
  })

  it('intersects a tag filter with a date filter', () => {
    const outcome = run('#tcc ontem')
    expect([...outcome.matched]).toEqual(['tcc-meeting'])
  })

  it('applies a colour filter with no text at all', () => {
    expect([...run('cor:azul').matched]).toEqual(['groceries'])
  })

  it('finds empty notes through the "vazias" flag', () => {
    expect([...run('vazias').matched]).toEqual(['blank'])
  })

  it('combines free text with a filter', () => {
    const outcome = run('metodologia #tcc')
    expect([...outcome.matched]).toEqual(['tcc-meeting'])
  })

  it('ranks the recent TCC note above the year-old one', () => {
    const outcome = run('tcc ')
    expect(outcome.results[0]!.noteId).toBe('tcc-meeting')
  })

  it('returns an empty result set when filters exclude everything', () => {
    expect(run('#inexistente').results).toHaveLength(0)
  })
})
