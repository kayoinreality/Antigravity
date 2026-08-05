/**
 * Generates a large, realistic canvas and measures the operations that decide
 * whether the app holds up.
 *
 * The claim this project makes is that memory scales with the data rather than
 * the view count, and that search and clustering stay usable at scale. Those
 * are checkable without a device for everything except the actual drawing, so
 * they are checked here rather than asserted.
 *
 *   npm run seed              # 10,000 notes, benchmark only
 *   npm run seed -- 50000     # a different size
 *   npm run seed -- 10000 --out seed.json   # also write importable notes
 *
 * The JSON it writes matches the wire shape sync_push accepts, so it can be
 * pushed into a real Supabase project to populate a device.
 */

import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import {
  LexicalProvider,
  NOTE_HEIGHT,
  NOTE_WIDTH,
  TextIndex,
  createNote,
  extractTags,
  searchNotes,
  type Note,
} from '../packages/core/src/index'
import { cullLinear, packBounds, visibleWorldRect } from '../packages/canvas-engine/src/index'

/**
 * Vocabulary that produces genuine topic structure.
 *
 * Realism matters here more than it looks. An earlier version of this file gave
 * each topic eight words and nothing else, which made every note in a topic a
 * near-duplicate of every other and every cross-topic pair a perfect zero —
 * flattering to the culling numbers and actively misleading about clustering.
 * Real notes are mostly ordinary words with a few topical ones threaded
 * through, which is what produces the partial overlaps the algorithm has to
 * cope with.
 */
const TOPICS: Array<{ tag: string; words: string[] }> = [
  { tag: 'tcc', words: ['monografia', 'orientador', 'banca', 'metodologia', 'referências', 'capítulo', 'defesa', 'cronograma', 'artigo', 'resumo', 'bibliografia', 'questionário', 'amostra', 'hipótese'] },
  { tag: 'treino', words: ['academia', 'supino', 'agachamento', 'halteres', 'séries', 'repetições', 'cardio', 'alongamento', 'esteira', 'aquecimento', 'carga', 'descanso', 'postura', 'proteína'] },
  { tag: 'receitas', words: ['farinha', 'fermento', 'açúcar', 'manteiga', 'forno', 'massa', 'recheio', 'calda', 'assadeira', 'batedeira', 'ovos', 'canela', 'chocolate', 'creme'] },
  { tag: 'trabalho', words: ['sprint', 'reunião', 'deploy', 'backlog', 'revisão', 'cliente', 'prazo', 'entrega', 'roadmap', 'métrica', 'incidente', 'proposta', 'contrato', 'apresentação'] },
  { tag: 'viagem', words: ['passagem', 'hospedagem', 'roteiro', 'bagagem', 'passaporte', 'câmbio', 'seguro', 'aeroporto', 'reserva', 'traslado', 'museu', 'ingresso', 'trem', 'mapa'] },
  { tag: 'financas', words: ['orçamento', 'investimento', 'dividendos', 'imposto', 'planilha', 'gastos', 'meta', 'poupança', 'juros', 'fatura', 'parcela', 'renda', 'aporte', 'carteira'] },
  { tag: 'leitura', words: ['autor', 'romance', 'ensaio', 'resenha', 'biblioteca', 'trecho', 'anotação', 'edição', 'tradução', 'prefácio', 'personagem', 'enredo', 'coletânea', 'crítica'] },
  { tag: 'casa', words: ['reforma', 'pintura', 'mudança', 'móveis', 'limpeza', 'conserto', 'jardim', 'compras', 'armário', 'tomada', 'vazamento', 'cortina', 'piso', 'orçamento'] },
]

/**
 * Words that carry no topic. Every note is mostly made of these, which is what
 * makes the benchmark's similarity distribution resemble a real canvas.
 */
const FILLER = [
  'precisa', 'lembrar', 'talvez', 'depois', 'antes', 'durante', 'agora', 'hoje',
  'amanhã', 'semana', 'mês', 'ideia', 'nota', 'lista', 'coisa', 'ponto',
  'melhor', 'pior', 'rápido', 'devagar', 'novo', 'velho', 'grande', 'pequeno',
  'começar', 'terminar', 'tentar', 'conseguir', 'perguntar', 'responder',
  'escrever', 'ler', 'olhar', 'pensar', 'decidir', 'marcar', 'avisar',
  'confirmar', 'checar', 'ajustar', 'trocar', 'comprar', 'vender', 'guardar',
  'manhã', 'tarde', 'noite', 'segunda', 'terça', 'quarta', 'quinta', 'sexta',
]

/** Deterministic PRNG so two runs are comparable. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function generate(count: number, seed = 42): Note[] {
  const random = makeRandom(seed)
  const notes: Note[] = []
  const now = Date.now()
  const DAY = 86_400_000

  // Notes are laid out in loose clumps rather than uniformly: a real canvas has
  // dense neighbourhoods and empty space, and culling behaves very differently
  // in the two cases.
  const clusterCount = Math.max(1, Math.round(count / 60))
  const centres = Array.from({ length: clusterCount }, () => ({
    x: (random() - 0.5) * 40_000,
    y: (random() - 0.5) * 40_000,
    topic: TOPICS[Math.floor(random() * TOPICS.length)]!,
  }))

  for (let i = 0; i < count; i++) {
    const centre = centres[Math.floor(random() * centres.length)]!
    const { topic } = centre

    const topical = () => topic.words[Math.floor(random() * topic.words.length)]!
    const filler = () => FILLER[Math.floor(random() * FILLER.length)]!

    const title = `${topical()} ${filler()}`
    // Roughly a third topical, the rest ordinary — close to how a real note
    // reads, and far harder for the clustering than an all-topical bag.
    const body = Array.from({ length: 10 + Math.floor(random() * 22) }, () =>
      random() < 0.34 ? topical() : filler(),
    ).join(' ')

    const note = createNote(
      {
        title: title.charAt(0).toUpperCase() + title.slice(1),
        content: `${body} #${topic.tag}`,
        x: centre.x + (random() - 0.5) * 2600,
        y: centre.y + (random() - 0.5) * 2600,
        tags: [topic.tag],
      },
      now - Math.floor(random() * 400) * DAY,
    )
    notes.push(note)
  }

  return notes
}

function bench(label: string, run: () => void, iterations = 1): number {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) run()
  const total = performance.now() - start
  const each = total / iterations
  console.log(`  ${label.padEnd(46)} ${each.toFixed(2).padStart(9)} ms`)
  return each
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const count = Number.parseInt(args.find((a) => /^\d+$/.test(a)) ?? '10000', 10)
  const outIndex = args.indexOf('--out')
  const outFile = outIndex >= 0 ? args[outIndex + 1] : null

  console.log(`\nantigravity — ${count.toLocaleString('en-US')} notes\n`)

  global.gc?.()
  const before = process.memoryUsage().heapUsed

  const notes = generate(count)
  global.gc?.()
  console.log(`  ${'note data in memory'.padEnd(46)} ${mb(process.memoryUsage().heapUsed - before).padStart(12)}`)

  // --- culling ------------------------------------------------------------
  console.log('\nculling (what runs every frame)')
  const packed = packBounds(
    notes.map((n) => ({ x: n.x, y: n.y, width: NOTE_WIDTH, height: NOTE_HEIGHT })),
  )
  const out = new Int32Array(notes.length)
  const viewport = { width: 1280, height: 800 }

  let visibleCount = 0
  const cullMs = bench(
    'cullLinear over the whole canvas',
    () => {
      visibleCount = cullLinear(
        packed,
        notes.length,
        visibleWorldRect({ x: 0, y: 0, scale: 1 }, viewport, 240),
        out,
      )
    },
    200,
  )
  console.log(`  ${'notes actually drawn at 1x zoom'.padEnd(46)} ${String(visibleCount).padStart(9)}`)
  console.log(`  ${'frame budget used by culling (of 8.3ms)'.padEnd(46)} ${((cullMs / 8.3) * 100).toFixed(1).padStart(8)} %`)

  // --- search -------------------------------------------------------------
  console.log('\nsearch')
  const index = new TextIndex()
  bench('build the full-text index', () => {
    index.clear()
    for (const note of notes) {
      index.add({ id: note.id, title: note.title, content: note.content, tags: extractTags(note) })
    }
  })

  bench('query: one word', () => void searchNotes({ query: 'monografia ', notes, index }), 20)
  bench('query: word + date + tag', () => void searchNotes({ query: 'monografia semana passada #tcc', notes, index }), 20)
  bench('query: filters only, no text', () => void searchNotes({ query: '#treino mês passado', notes, index }), 20)

  // --- clustering ---------------------------------------------------------
  // Swept rather than measured once, because the cost curve is what decides
  // where the app caps its input. Clustering runs in a background task, but a
  // background task that blocks for a second still drops frames.
  console.log('\nclustering (background task — cost decides the input cap)')
  const provider = new LexicalProvider()

  for (const size of [500, 1500, 3000, 6000].filter((n) => n <= count)) {
    const sample = notes.slice(0, size)
    const start = performance.now()
    const clusters = await provider.cluster(sample)
    const elapsed = performance.now() - start
    console.log(
      `  ${`${String(size).padStart(5)} notes`.padEnd(46)} ${elapsed.toFixed(1).padStart(9)} ms` +
        `   ${String(clusters.length).padStart(3)} systems` +
        (clusters.length > 0 ? `   ${clusters.slice(0, 3).map((c) => c.label).join(', ')}` : ''),
    )
  }

  if (outFile) {
    writeFileSync(
      outFile,
      JSON.stringify(
        {
          notes: notes.map((n) => ({
            id: n.id,
            title: n.title,
            content: n.content,
            x: n.x,
            y: n.y,
            color: n.color,
            tags: n.tags,
            systemId: null,
            orbitRadius: null,
            orbitAngle: null,
            pinned: false,
            createdAt: n.createdAt,
            updatedAt: n.updatedAt,
            deletedAt: null,
          })),
          systems: [],
          links: [],
        },
        null,
        0,
      ),
    )
    console.log(`\n  wrote ${outFile}`)
  }

  console.log('')
}

void main()
