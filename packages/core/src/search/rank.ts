/**
 * The one ranking formula, shared by both apps.
 *
 * Full-text relevance comes from a different engine on each platform (FTS5's
 * bm25 on mobile, MiniSearch on web) and the two produce numbers on completely
 * different scales. Rather than trying to make the engines agree, each supplies
 * a raw score and this module normalizes it before mixing in the signals that
 * *are* platform-independent. Same inputs, same order, everywhere.
 */

export interface RankInput {
  noteId: string
  /** Engine-supplied relevance, higher = better, ≥ 0. Pass 0 with no text query. */
  textScore: number
  updatedAt: number
  pinned: boolean
  /** Note belongs to the system the user is currently filtering by. */
  inActiveSystem: boolean
}

export interface RankedResult {
  noteId: string
  score: number
  rank: number
}

export interface RankOptions {
  now?: number
  /** False when the query had only filters — recency then leads. */
  hasTextQuery: boolean
  /** Days after which recency contributes half as much. */
  halfLifeDays?: number
}

const WEIGHT_TEXT = 0.72
const WEIGHT_RECENCY = 0.2
const WEIGHT_PINNED = 0.05
const WEIGHT_SYSTEM = 0.03
const DAY = 86_400_000

export function rankResults(inputs: RankInput[], options: RankOptions): RankedResult[] {
  const now = options.now ?? Date.now()
  const halfLife = options.halfLifeDays ?? 45

  let maxText = 0
  for (const input of inputs) {
    if (input.textScore > maxText) maxText = input.textScore
  }

  const scored = inputs.map((input) => {
    const textNorm = maxText > 0 ? input.textScore / maxText : 0
    const ageDays = Math.max(0, (now - input.updatedAt) / DAY)
    const recency = Math.pow(0.5, ageDays / halfLife)

    // With no text query every note ties at textNorm = 0, so redistribute that
    // weight onto recency instead of letting the whole result set score ~0.05.
    const textWeight = options.hasTextQuery ? WEIGHT_TEXT : 0
    const recencyWeight = options.hasTextQuery
      ? WEIGHT_RECENCY
      : WEIGHT_RECENCY + WEIGHT_TEXT

    const score =
      textWeight * textNorm +
      recencyWeight * recency +
      (input.pinned ? WEIGHT_PINNED : 0) +
      (input.inActiveSystem ? WEIGHT_SYSTEM : 0)

    return { noteId: input.noteId, score }
  })

  scored.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.noteId < b.noteId ? -1 : 1,
  )

  return scored.map((entry, index) => ({ ...entry, rank: index }))
}

/**
 * FTS5 returns bm25() as a *negative* number where more-negative is better.
 * Flipping it here keeps that quirk from leaking into the shared formula.
 */
export function normalizeBm25(raw: number): number {
  return raw < 0 ? -raw : 0
}
