/**
 * The delete gesture: pick a note up and throw it against gravity.
 *
 * Everything in this file is pure and worklet-safe, because the whole
 * interaction has to run on the UI thread. A deletion animation that stutters
 * because the JS thread is busy persisting the previous edit would undercut the
 * entire premise — the gesture is the feature, so it has to feel physical.
 *
 * The flow, in stages:
 *   Idle -> Held (long press) -> Dragging -> Armed (dragged up far and fast
 *   enough that the singularity appears) -> Captured (released inside the
 *   event horizon) or back to Dragging.
 */

export const enum BlackHoleStage {
  Idle = 0,
  Held = 1,
  Dragging = 2,
  Armed = 3,
  Captured = 4,
}

export interface BlackHoleConfig {
  /** Fraction of viewport height the note must travel upward to arm. */
  armDistanceRatio: number
  /** Upward velocity (px/s, negative is up) required alongside the distance. */
  armVelocity: number
  /** Screen radius of the event horizon. Release inside this and it is gone. */
  horizonRadius: number
  /** Where the singularity sits, as a fraction of viewport height from the top. */
  centreYRatio: number
  /** Distance at which the pull starts being visible. */
  influenceRadius: number
}

export const DEFAULT_CONFIG: BlackHoleConfig = {
  armDistanceRatio: 0.12,
  armVelocity: -220,
  horizonRadius: 88,
  centreYRatio: 0.14,
  influenceRadius: 420,
}

export interface DragState {
  /** Note centre in screen space, following the finger. */
  x: number
  y: number
  /** Cumulative translation since the drag began. */
  translationY: number
  velocityY: number
}

export interface BlackHoleVisual {
  stage: BlackHoleStage
  /** 0 when dormant, 1 at full presence. Drives opacity and disc size. */
  presence: number
  /** 0 outside the influence radius, 1 at the singularity. */
  pull: number
  /** Note centre after gravity bends it off the finger's path. */
  noteX: number
  noteY: number
  /** Spaghettification: >1 stretches along the pull axis. */
  stretch: number
  /** Perpendicular squeeze, always <= 1. */
  squeeze: number
  /** Radians; the note rotates to point at the singularity. */
  rotation: number
  /** 0 = untouched colour, 1 = drained to white just before the horizon. */
  drain: number
  /** True while release would delete. */
  willCapture: boolean
}

export function singularityX(viewportWidth: number): number {
  'worklet'
  return viewportWidth / 2
}

export function singularityY(viewportHeight: number, config: BlackHoleConfig): number {
  'worklet'
  return viewportHeight * config.centreYRatio
}

/**
 * Arming needs *both* distance and speed. Distance alone would arm on a slow
 * deliberate drag toward the top of the canvas, which is ordinary note
 * arrangement, not a delete. Requiring a flick makes the destructive gesture
 * something you have to mean.
 */
export function shouldArm(
  drag: DragState,
  viewportHeight: number,
  config: BlackHoleConfig,
): boolean {
  'worklet'
  return (
    drag.translationY < -viewportHeight * config.armDistanceRatio &&
    drag.velocityY < config.armVelocity
  )
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  'worklet'
  const t = (value - edge0) / (edge1 - edge0)
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t
  return clamped * clamped * (3 - 2 * clamped)
}

/**
 * Computes everything the renderer needs for one frame of the gesture.
 *
 * `presence` is passed in rather than derived so the caller can spring it — the
 * singularity fades in over a few frames instead of popping into existence the
 * instant the arm threshold is crossed.
 */
export function computeVisual(
  stage: BlackHoleStage,
  drag: DragState,
  viewportWidth: number,
  viewportHeight: number,
  presence: number,
  config: BlackHoleConfig = DEFAULT_CONFIG,
): BlackHoleVisual {
  'worklet'
  const cx = singularityX(viewportWidth)
  const cy = singularityY(viewportHeight, config)

  const dx = cx - drag.x
  const dy = cy - drag.y
  const distance = Math.sqrt(dx * dx + dy * dy)

  if (stage < BlackHoleStage.Armed || presence <= 0) {
    return {
      stage,
      presence,
      pull: 0,
      noteX: drag.x,
      noteY: drag.y,
      stretch: 1,
      squeeze: 1,
      rotation: 0,
      drain: 0,
      willCapture: false,
    }
  }

  // Gravity falls off with the square of distance, normalized so it reaches 1
  // at the horizon and 0 at the edge of influence. Using the raw 1/d^2 would
  // send the note to infinity as it approaches, which reads as a glitch.
  const normalized = smoothstep(config.influenceRadius, config.horizonRadius, distance)
  const pull = normalized * normalized * presence

  // The note is dragged off the finger's line toward the singularity. At full
  // pull it sits on the singularity regardless of where the finger is, which is
  // what makes the last few pixels feel inevitable.
  const noteX = drag.x + dx * pull
  const noteY = drag.y + dy * pull

  const rotation = Math.atan2(dy, dx) + Math.PI / 2

  return {
    stage,
    presence,
    pull,
    noteX,
    noteY,
    stretch: 1 + pull * 1.9,
    squeeze: 1 - pull * 0.62,
    rotation,
    drain: smoothstep(config.influenceRadius * 0.55, config.horizonRadius, distance),
    willCapture: distance <= config.horizonRadius,
  }
}

/** Release handler: did the note fall in, or does it spring home? */
export function resolveRelease(
  drag: DragState,
  viewportWidth: number,
  viewportHeight: number,
  stage: BlackHoleStage,
  config: BlackHoleConfig = DEFAULT_CONFIG,
): BlackHoleStage {
  'worklet'
  if (stage < BlackHoleStage.Armed) return BlackHoleStage.Idle

  const dx = singularityX(viewportWidth) - drag.x
  const dy = singularityY(viewportHeight, config) - drag.y
  const distance = Math.sqrt(dx * dx + dy * dy)

  return distance <= config.horizonRadius ? BlackHoleStage.Captured : BlackHoleStage.Idle
}

/**
 * Accretion disc rotation for a given time. Kept here so both renderers spin
 * at the same rate rather than each inventing one.
 */
export function discAngle(elapsedMs: number): number {
  'worklet'
  return (elapsedMs / 2600) * Math.PI * 2
}

/**
 * Haptic intensity ramp, 0–1, as the note nears the horizon. The mobile app
 * maps this onto impact styles; the web app ignores it.
 */
export function hapticIntensity(pull: number): number {
  'worklet'
  return pull < 0.25 ? 0 : (pull - 0.25) / 0.75
}
