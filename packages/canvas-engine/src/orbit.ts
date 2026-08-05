/**
 * Solar-system layout.
 *
 * When a cluster is accepted, its notes stop being scattered and take up orbits
 * around a labelled star. The layout has to satisfy three things at once:
 *
 *  - No overlaps, without running a physics relaxation. Rings are sized from
 *    the note diagonal and the arc each note needs, so non-overlap falls out of
 *    the geometry rather than being iterated toward.
 *  - Deterministic. The same membership always produces the same sky, so a
 *    re-render or a re-open never reshuffles it.
 *  - Meaningful. Ring assignment follows similarity to the cluster centroid, so
 *    the most on-topic notes sit closest to the star.
 *
 * Notes on a ring are spread evenly across the *occupied* arc rather than
 * pinned to fixed slots. Fixed slots would keep coordinates identical when a
 * note joins, but a half-filled outer ring then shows an obvious wedge of empty
 * space. Even spacing means adding a member re-flows its ring — which is fine,
 * because the caller animates the change and planets drifting to make room
 * reads as intentional.
 */

export interface OrbitSlot {
  noteId: string
  /** Distance from the star, world units. */
  radius: number
  /** Radians, measured from the positive x-axis. */
  angle: number
  x: number
  y: number
  /** 0-based ring, for staggering the insertion animation outward. */
  ring: number
}

export interface OrbitLayoutOptions {
  /** Clear space around the star glyph. */
  innerRadius?: number
  /** Extra gap between consecutive rings. */
  ringGap?: number
  noteWidth?: number
  noteHeight?: number
}

export interface OrbitMember {
  noteId: string
  /** Similarity to the cluster centroid; higher orbits closer. */
  affinity: number
  /** Tiebreaker that keeps the layout stable as the cluster grows. */
  createdAt: number
}

const DEFAULTS = {
  innerRadius: 190,
  ringGap: 56,
  noteWidth: 200,
  noteHeight: 132,
}

export function layoutSystem(
  members: OrbitMember[],
  centreX: number,
  centreY: number,
  options: OrbitLayoutOptions = {},
): OrbitSlot[] {
  const innerRadius = options.innerRadius ?? DEFAULTS.innerRadius
  const ringGap = options.ringGap ?? DEFAULTS.ringGap
  const noteWidth = options.noteWidth ?? DEFAULTS.noteWidth
  const noteHeight = options.noteHeight ?? DEFAULTS.noteHeight

  if (members.length === 0) return []

  // Worst-case footprint: a note can present its diagonal to a neighbour, so
  // spacing on the diagonal is what guarantees no overlap at any angle.
  const footprint = Math.sqrt(noteWidth * noteWidth + noteHeight * noteHeight)
  const ringSpacing = footprint + ringGap

  const ordered = [...members].sort((a, b) =>
    b.affinity !== a.affinity ? b.affinity - a.affinity : a.createdAt - b.createdAt,
  )

  const slots: OrbitSlot[] = []
  let index = 0
  let ring = 0

  while (index < ordered.length) {
    const radius = innerRadius + ring * ringSpacing
    // How many notes fit on this circumference without their footprints
    // touching. At least one, or a tight inner ring would loop forever.
    const capacity = Math.max(1, Math.floor((2 * Math.PI * radius) / footprint))
    const take = Math.min(capacity, ordered.length - index)

    // Alternate the starting angle per ring so notes are not radially aligned,
    // which would leave visible spokes of empty space.
    const angleStep = (2 * Math.PI) / take
    const angleOffset = ring % 2 === 0 ? 0 : angleStep / 2

    for (let i = 0; i < take; i++) {
      const member = ordered[index + i]!
      const angle = angleOffset + i * angleStep
      slots.push({
        noteId: member.noteId,
        radius,
        angle,
        x: centreX + Math.cos(angle) * radius - noteWidth / 2,
        y: centreY + Math.sin(angle) * radius - noteHeight / 2,
        ring,
      })
    }

    index += take
    ring += 1
  }

  return slots
}

/** Re-derives a note's position from its stored orbit, after the star moves. */
export function orbitPosition(
  centreX: number,
  centreY: number,
  radius: number,
  angle: number,
  noteWidth = DEFAULTS.noteWidth,
  noteHeight = DEFAULTS.noteHeight,
): { x: number; y: number } {
  'worklet'
  return {
    x: centreX + Math.cos(angle) * radius - noteWidth / 2,
    y: centreY + Math.sin(angle) * radius - noteHeight / 2,
  }
}

/**
 * Escape velocity: dragging a note far enough out of its orbit detaches it.
 *
 * The threshold is a multiple of the orbit radius rather than a fixed distance,
 * so a note on a tight inner ring does not need the same absolute drag as one
 * on the rim to break free.
 */
export const ESCAPE_MULTIPLIER = 1.6

export function hasEscaped(
  noteCentreX: number,
  noteCentreY: number,
  centreX: number,
  centreY: number,
  orbitRadius: number,
): boolean {
  'worklet'
  const dx = noteCentreX - centreX
  const dy = noteCentreY - centreY
  return Math.sqrt(dx * dx + dy * dy) > orbitRadius * ESCAPE_MULTIPLIER
}

/**
 * Per-note delay for the insertion animation, so a system assembles from the
 * inside out instead of every note arriving at once.
 */
export function insertionDelay(slot: OrbitSlot, stepMs = 18): number {
  return (slot.ring * 6 + Math.round(slot.angle / (Math.PI / 6))) * stepMs
}

/** Bounding box of a laid-out system, for framing it with the camera. */
export function systemBounds(
  slots: OrbitSlot[],
  noteWidth = DEFAULTS.noteWidth,
  noteHeight = DEFAULTS.noteHeight,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (slots.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const slot of slots) {
    if (slot.x < minX) minX = slot.x
    if (slot.y < minY) minY = slot.y
    if (slot.x + noteWidth > maxX) maxX = slot.x + noteWidth
    if (slot.y + noteHeight > maxY) maxY = slot.y + noteHeight
  }

  return { minX, minY, maxX, maxY }
}
