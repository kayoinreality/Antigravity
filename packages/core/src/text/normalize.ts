/**
 * Text normalization shared by search, clustering and colour matching.
 *
 * Portuguese is the primary language here, so accent folding is not optional:
 * a user who types "analise" must find a note that says "análise", and FTS5 is
 * configured with `remove_diacritics 2` on the mobile side to match this.
 */

export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function fold(value: string): string {
  return stripAccents(value.toLowerCase()).trim()
}

/**
 * Folds while guaranteeing `result.length === value.length` and that index `i`
 * in the result corresponds to index `i` in the input.
 *
 * The search parser reports character spans so a dismissed chip can be cut out
 * of the raw query string. Plain `fold()` cannot be used for that: `toLowerCase`
 * and NFD normalization can both change length (e.g. 'İ' lowercases to two code
 * units), which would silently shift every span after it. Folding per character
 * and keeping the original whenever the fold is not 1:1 trades a little
 * normalization on exotic input for spans that are always correct.
 */
export function foldAligned(value: string): string {
  let out = ''
  for (const char of value) {
    const folded = stripAccents(char.toLowerCase())
    out += folded.length === char.length ? folded : char
  }
  return out
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu

export function tokenize(value: string): string[] {
  return Array.from(fold(value).matchAll(WORD_RE), (m) => m[0])
}

/**
 * Stopwords for both languages the app ships in. Deliberately conservative:
 * over-trimming makes clusters merge on nothing, so this only covers function
 * words that carry no topical signal.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  // pt-BR
  'a', 'ao', 'aos', 'as', 'ate', 'com', 'como', 'da', 'das', 'de', 'do', 'dos',
  'e', 'ela', 'elas', 'ele', 'eles', 'em', 'entre', 'era', 'essa', 'esse',
  'esta', 'este', 'eu', 'foi', 'for', 'isso', 'ja', 'la', 'mais', 'mas', 'me',
  'mesmo', 'meu', 'minha', 'muito', 'na', 'nao', 'nas', 'nem', 'no', 'nos',
  'nossa', 'nosso', 'num', 'numa', 'o', 'os', 'ou', 'para', 'pela', 'pelo',
  'per', 'pelos', 'por', 'qual', 'quando', 'que', 'quem', 'se', 'sem', 'ser',
  'seu', 'sua', 'so', 'sao', 'tem', 'tinha', 'ter', 'teu', 'tua', 'um', 'uma',
  'voce', 'vos', 'ja', 'pra', 'pro', 'dele', 'dela', 'isto', 'aqui', 'ai',
  // en
  'a', 'about', 'all', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been',
  'but', 'by', 'can', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have',
  'he', 'her', 'his', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'no',
  'not', 'of', 'on', 'or', 'our', 'out', 'she', 'so', 'some', 'that', 'the',
  'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'up', 'was',
  'we', 'were', 'what', 'when', 'which', 'who', 'will', 'with', 'you', 'your',
])

/**
 * Suffix stripper, not a real stemmer. It exists so "reunião"/"reuniões" and
 * "projeto"/"projetos" land on the same term when clustering — going further
 * (full RSLP) costs more than it buys for note-sized documents.
 */
const SUFFIXES = [
  'acoes', 'amentos', 'imentos', 'mente', 'coes', 'oes', 'aes', 'eis',
  'amento', 'imento', 'ando', 'endo', 'indo', 'ador', 'idade', 'ivel', 'avel',
  'ista', 'ismo', 'ing', 'ies', 'ed', 'es', 'as', 'os', 'ns', 's',
]

export function stem(token: string): string {
  if (token.length <= 4) return token
  for (const suffix of SUFFIXES) {
    if (token.length - suffix.length >= 3 && token.endsWith(suffix)) {
      return token.slice(0, token.length - suffix.length)
    }
  }
  return token
}

/** Content words only: folded, de-stopworded, stemmed, length-filtered. */
export function contentTerms(value: string): string[] {
  const out: string[] = []
  for (const token of tokenize(value)) {
    if (token.length < 3) continue
    if (STOPWORDS.has(token)) continue
    out.push(stem(token))
  }
  return out
}
