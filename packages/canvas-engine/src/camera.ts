/**
 * Camera maths for the infinite canvas.
 *
 * Every function here is pure and free of closures over non-primitives, which
 * is what lets the mobile app call the same code inside a Reanimated worklet on
 * the UI thread. That matters more than it sounds: pan and zoom never touch the
 * JS thread, so the canvas keeps moving at display rate no matter what the
 * store is doing.
 *
 * Convention: the camera holds a translation in *screen* pixels and a scale.
 * World -> screen is `p * scale + translate`. There is no canvas-sized backing
 * view — the world is genuinely unbounded, which is why the old build's
 * 8000x8000 container is gone.
 */

export interface Camera {
  x: number
  y: number
  scale: number
}

export interface Viewport {
  width: number
  height: number
}

export interface Rect {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * At MIN_SCALE a 200-unit note renders about 4px wide — exactly the star glyph
 * the lowest LOD draws, so this is the point past which zooming out stops
 * showing anything new. It also has to be low enough that `fitBounds` can
 * actually frame a spread-out canvas: on a 400px-wide phone this allows roughly
 * 20,000 world units on screen at once.
 */
export const MIN_SCALE = 0.02
export const MAX_SCALE = 4

export function clampScale(scale: number): number {
  'worklet'
  return scale < MIN_SCALE ? MIN_SCALE : scale > MAX_SCALE ? MAX_SCALE : scale
}

export function worldToScreenX(worldX: number, camera: Camera): number {
  'worklet'
  return worldX * camera.scale + camera.x
}

export function worldToScreenY(worldY: number, camera: Camera): number {
  'worklet'
  return worldY * camera.scale + camera.y
}

export function screenToWorldX(screenX: number, camera: Camera): number {
  'worklet'
  return (screenX - camera.x) / camera.scale
}

export function screenToWorldY(screenY: number, camera: Camera): number {
  'worklet'
  return (screenY - camera.y) / camera.scale
}

/**
 * Zooms about a fixed screen point, so the pixel under the pinch focus (or the
 * mouse cursor) stays put. Zooming about the viewport centre instead is the
 * single most common way an infinite canvas feels wrong.
 */
export function zoomAt(
  camera: Camera,
  focusScreenX: number,
  focusScreenY: number,
  nextScale: number,
): Camera {
  'worklet'
  const scale = clampScale(nextScale)
  const worldX = (focusScreenX - camera.x) / camera.scale
  const worldY = (focusScreenY - camera.y) / camera.scale
  return {
    scale,
    x: focusScreenX - worldX * scale,
    y: focusScreenY - worldY * scale,
  }
}

/** The world-space rectangle currently on screen, grown by `padding` pixels. */
export function visibleWorldRect(
  camera: Camera,
  viewport: Viewport,
  padding = 0,
): Rect {
  'worklet'
  const inverseScale = 1 / camera.scale
  const padWorld = padding * inverseScale
  const minX = (0 - camera.x) * inverseScale - padWorld
  const minY = (0 - camera.y) * inverseScale - padWorld
  return {
    minX,
    minY,
    maxX: minX + viewport.width * inverseScale + padWorld * 2,
    maxY: minY + viewport.height * inverseScale + padWorld * 2,
  }
}

export interface FitOptions {
  /** Screen-space breathing room around the framed content. */
  padding?: number
  /** Never zoom in past this when framing a single small item. */
  maxScale?: number
}

/**
 * Frames a world rectangle. Used when search wants to show every match at once
 * and when the camera warps to a selected result.
 */
export function fitBounds(
  bounds: Rect,
  viewport: Viewport,
  options: FitOptions = {},
): Camera {
  const padding = options.padding ?? 80
  const maxScale = options.maxScale ?? 1.1

  const width = Math.max(1, bounds.maxX - bounds.minX)
  const height = Math.max(1, bounds.maxY - bounds.minY)

  const availableWidth = Math.max(1, viewport.width - padding * 2)
  const availableHeight = Math.max(1, viewport.height - padding * 2)

  const scale = clampScale(
    Math.min(maxScale, Math.min(availableWidth / width, availableHeight / height)),
  )

  const centreX = (bounds.minX + bounds.maxX) / 2
  const centreY = (bounds.minY + bounds.maxY) / 2

  return {
    scale,
    x: viewport.width / 2 - centreX * scale,
    y: viewport.height / 2 - centreY * scale,
  }
}

/** Centres a world point without changing zoom. */
export function centreOn(
  worldX: number,
  worldY: number,
  viewport: Viewport,
  scale: number,
): Camera {
  'worklet'
  return {
    scale,
    x: viewport.width / 2 - worldX * scale,
    y: viewport.height / 2 - worldY * scale,
  }
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  'worklet'
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

export function unionRect(a: Rect, b: Rect): Rect {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}
