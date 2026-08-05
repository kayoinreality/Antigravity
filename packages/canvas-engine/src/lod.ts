/**
 * Level of detail.
 *
 * This is the performance lever and the aesthetic one at the same time. Zoomed
 * out, a note cannot render legible text anyway, so it collapses to a point of
 * light — which is both an order of magnitude cheaper to draw and exactly the
 * "sky full of thoughts" the canvas is going for.
 *
 * Each level is a separately cached picture per note on the mobile renderer,
 * so switching levels costs a lookup rather than a re-layout.
 */

export const enum Lod {
  /** A 4px dot. No text, no shadow, no border. */
  Star = 0,
  /** Card with a title only. */
  Card = 1,
  /** Card with title, body preview and metadata. */
  Full = 2,
}

const STAR_BELOW = 0.35
const CARD_BELOW = 0.7

export function lodForScale(scale: number): Lod {
  'worklet'
  if (scale < STAR_BELOW) return Lod.Star
  if (scale < CARD_BELOW) return Lod.Card
  return Lod.Full
}

/**
 * Hysteresis band around a level boundary.
 *
 * Without it, holding a pinch exactly on 0.35 makes every note on screen flip
 * between star and card every frame. The renderer keeps the previous level
 * until the scale has moved clear of the boundary by this margin.
 */
const HYSTERESIS = 0.03

export function lodWithHysteresis(scale: number, previous: Lod): Lod {
  'worklet'
  const next = lodForScale(scale)
  if (next === previous) return previous

  if (previous === Lod.Star && next === Lod.Card && scale < STAR_BELOW + HYSTERESIS) return previous
  if (previous === Lod.Card && next === Lod.Star && scale > STAR_BELOW - HYSTERESIS) return previous
  if (previous === Lod.Card && next === Lod.Full && scale < CARD_BELOW + HYSTERESIS) return previous
  if (previous === Lod.Full && next === Lod.Card && scale > CARD_BELOW - HYSTERESIS) return previous

  return next
}

/** Radius of the star glyph, in world units, so it stays ~4px on screen. */
export function starRadius(scale: number): number {
  'worklet'
  return 4 / scale
}
