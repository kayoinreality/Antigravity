import { describe, expect, it } from 'vitest'
import { clusterNotes } from './cluster'
import { toSuggestions } from './provider'
import { buildCorpus, buildVector, cosine } from './vector'
import { createNote } from '../model/note'
import type { Note } from '../model/types'

const NOW = new Date(2026, 2, 18).getTime()

let seq = 0
function note(title: string, content: string, overrides: Partial<Note> = {}): Note {
  seq += 1
  return {
    ...createNote({ title, content }, NOW),
    id: `n${seq}`,
    x: seq * 40,
    y: seq * 25,
    ...overrides,
  }
}

/** Three clearly separate topics, with enough vocabulary overlap inside each. */
function threeTopics(): Note[] {
  seq = 0
  return [
    note('Reunião TCC', 'orientador definiu o cronograma da monografia e da banca'),
    note('Monografia TCC', 'escrever o capítulo de metodologia da monografia'),
    note('Banca TCC', 'agendar a banca com o orientador e revisar a monografia'),

    note('Treino perna', 'agachamento leg press e cadeira extensora na academia'),
    note('Treino costas', 'barra fixa remada e puxada na academia com halteres'),
    note('Treino peito', 'supino reto inclinado e crucifixo na academia'),

    note('Receita bolo', 'farinha ovos açúcar fermento e leite para o bolo'),
    note('Receita pão', 'farinha fermento água sal para o pão caseiro'),
    note('Receita torta', 'farinha ovos manteiga e açúcar para a torta doce'),
  ]
}

describe('vectors', () => {
  it('scores two notes on the same topic higher than two on different topics', () => {
    const notes = threeTopics()
    const corpus = buildCorpus(notes)
    const vectors = notes.map((n) => buildVector(n, corpus))

    const sameTopic = cosine(vectors[0]!, vectors[1]!)
    const differentTopic = cosine(vectors[0]!, vectors[4]!)

    expect(sameTopic).toBeGreaterThan(differentTopic)
  })

  it('produces an empty vector for a note with no content words', () => {
    const corpus = buildCorpus([note('', '')])
    expect(buildVector(note('', ''), corpus).size).toBe(0)
  })

  it('normalizes vectors to unit length', () => {
    const notes = threeTopics()
    const corpus = buildCorpus(notes)
    const vector = buildVector(notes[0]!, corpus)
    const norm = Math.sqrt([...vector.values()].reduce((s, w) => s + w * w, 0))
    expect(norm).toBeCloseTo(1, 6)
  })
})

describe('clusterNotes', () => {
  it('separates three topics into three groups', () => {
    const clusters = clusterNotes(threeTopics())
    expect(clusters).toHaveLength(3)
    expect(clusters.every((c) => c.noteIds.length === 3)).toBe(true)
  })

  it('keeps notes about the same thing together', () => {
    const clusters = clusterNotes(threeTopics())
    const withN1 = clusters.find((c) => c.noteIds.includes('n1'))!
    expect(withN1.noteIds).toEqual(['n1', 'n2', 'n3'])
  })

  it('labels a cluster with a term that is distinctive, not merely frequent', () => {
    const clusters = clusterNotes(threeTopics())
    const tccCluster = clusters.find((c) => c.noteIds.includes('n1'))!
    // "monografia"/"tcc"/"banca" distinguish this group; "receita" would not.
    expect(tccCluster.terms.some((t) => ['tcc', 'monograf', 'banca', 'orientador'].includes(t))).toBe(true)
  })

  it('is deterministic across runs so the suggestion does not flicker', () => {
    const a = clusterNotes(threeTopics())
    const b = clusterNotes(threeTopics())
    expect(a.map((c) => c.noteIds)).toEqual(b.map((c) => c.noteIds))
    expect(a.map((c) => c.label)).toEqual(b.map((c) => c.label))
  })

  it('is order-independent — shuffling the input gives the same groups', () => {
    const forward = clusterNotes(threeTopics())
    const shuffled = clusterNotes([...threeTopics()].reverse())
    const key = (groups: { noteIds: string[] }[]) =>
      groups.map((g) => g.noteIds.join(',')).sort()
    expect(key(shuffled)).toEqual(key(forward))
  })

  it('returns nothing when notes share no vocabulary', () => {
    seq = 0
    const unrelated = [
      note('Alpha', 'zebra quartzo violino'),
      note('Beta', 'guitarra oceano bicicleta'),
      note('Gamma', 'telescópio manteiga ferrovia'),
    ]
    expect(clusterNotes(unrelated)).toHaveLength(0)
  })

  it('ignores deleted notes', () => {
    const notes = threeTopics().map((n, i) =>
      i < 3 ? { ...n, deletedAt: NOW } : n,
    )
    const clusters = clusterNotes(notes)
    expect(clusters.flatMap((c) => c.noteIds)).not.toContain('n1')
  })

  it('places the centroid at the mean position of its members', () => {
    const clusters = clusterNotes(threeTopics())
    const tcc = clusters.find((c) => c.noteIds.includes('n1'))!
    expect(tcc.centroidX).toBeCloseTo((40 + 80 + 120) / 3, 6)
    expect(tcc.centroidY).toBeCloseTo((25 + 50 + 75) / 3, 6)
  })

  it('does not suggest a group below minSize', () => {
    seq = 0
    const pair = [
      note('TCC a', 'monografia orientador banca'),
      note('TCC b', 'monografia orientador banca'),
    ]
    expect(clusterNotes(pair, { minSize: 3 })).toHaveLength(0)
  })
})

describe('toSuggestions', () => {
  it('skips clusters whose notes already belong to a system', () => {
    const notes = threeTopics().map((n, i) =>
      i < 3 ? { ...n, systemId: 'existing-system' } : n,
    )
    const suggestions = toSuggestions(clusterNotes(notes), notes)
    expect(suggestions.some((s) => s.noteIds.includes('n1'))).toBe(false)
  })

  it('respects a dismissal', () => {
    const notes = threeTopics()
    const first = toSuggestions(clusterNotes(notes), notes)
    expect(first.length).toBeGreaterThan(0)

    const again = toSuggestions(clusterNotes(notes), notes, {
      dismissed: new Set([first[0]!.key]),
    })
    expect(again.map((s) => s.key)).not.toContain(first[0]!.key)
  })

  it('produces a key that survives reordering of the same note set', () => {
    const notes = threeTopics()
    const a = toSuggestions(clusterNotes(notes), notes)
    const b = toSuggestions(clusterNotes([...notes].reverse()), notes)
    expect(new Set(a.map((s) => s.key))).toEqual(new Set(b.map((s) => s.key)))
  })

  it('stays quiet when confidence is below the bar', () => {
    const notes = threeTopics()
    expect(toSuggestions(clusterNotes(notes), notes, { minConfidence: 0.99 })).toHaveLength(0)
  })
})
