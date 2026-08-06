import { visibleWorldRect, type Camera, type Rect, type Viewport } from './camera'

/**
 * Viewport culling.
 *
 * The old build mounted every note as a native view all the time; at a thousand
 * notes that is roughly five thousand views and the app dies. Here the renderer
 * asks "what is on screen" every frame and draws only that — typically well
 * under a hundred notes regardless of how many exist.
 *
 * Two strategies, picked by size:
 *
 *  - Linear scan over packed Float32Arrays. A few thousand comparisons per
 *    frame is nothing, and it is worklet-safe (no Map, no object allocation),
 *    so it can run on the UI thread with the camera.
 *  - A uniform spatial hash for larger canvases, where scanning everything
 *    would start to show. Built on the JS thread when note positions change,
 *    queried per frame.
 *
 * Both return indices into the same packed layout, so the renderer does not
 * care which one answered.
 */

export const STRIDE = 4 // x, y, width, height

/** Packs note geometry into one contiguous buffer the UI thread can read. */
export function packBounds(
  notes: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
): Float32Array {
  const packed = new Float32Array(notes.length * STRIDE)
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]!
    const base = i * STRIDE
    packed[base] = note.x
    packed[base + 1] = note.y
    packed[base + 2] = note.width
    packed[base + 3] = note.height
  }
  return packed
}

/**
 * Indices of every packed rect intersecting `view`.
 *
 * `out` is reused across frames by the caller so a steady-state pan allocates
 * nothing; the return value is how many entries of it are valid.
 */
export function cullLinear(
  packed: Float32Array,
  count: number,
  view: Rect,
  out: Int32Array,
): number {
  'worklet'
  let found = 0
  for (let i = 0; i < count; i++) {
    const base = i * STRIDE
    const x = packed[base]!
    const y = packed[base + 1]!
    if (
      x < view.maxX &&
      x + packed[base + 2]! > view.minX &&
      y < view.maxY &&
      y + packed[base + 3]! > view.minY
    ) {
      if (found >= out.length) break
      out[found++] = i
    }
  }
  return found
}

/** Beyond this many notes the linear scan gives way to the grid. */
export const GRID_THRESHOLD = 2000

export class SpatialGrid {
  private readonly cellSize: number
  private readonly cells = new Map<number, number[]>()

  constructor(cellSize = 512) {
    this.cellSize = cellSize
  }

  /** Rebuilt whenever note geometry changes; cheap enough to redo wholesale. */
  build(packed: Float32Array, count: number): void {
    this.cells.clear()
    for (let i = 0; i < count; i++) {
      const base = i * STRIDE
      const x = packed[base]!
      const y = packed[base + 1]!
      const maxX = x + packed[base + 2]!
      const maxY = y + packed[base + 3]!

      // A note can straddle cell borders, so register it in every cell it
      // touches and let the query de-duplicate.
      for (let cx = this.cellOf(x); cx <= this.cellOf(maxX); cx++) {
        for (let cy = this.cellOf(y); cy <= this.cellOf(maxY); cy++) {
          const key = this.key(cx, cy)
          const bucket = this.cells.get(key)
          if (bucket) bucket.push(i)
          else this.cells.set(key, [i])
        }
      }
    }
  }

  /**
   * Broad phase followed by an exact test.
   *
   * Cell membership only proves a note is *near* the view — a note in the
   * corner of an overlapping cell can still be entirely off screen. Without the
   * second test the grid returns a superset of what the linear scan returns,
   * and the two paths drift apart as the canvas grows past the threshold.
   */
  query(packed: Float32Array, view: Rect, out: Int32Array, seen: Uint8Array): number {
    seen.fill(0)
    let found = 0

    for (let cx = this.cellOf(view.minX); cx <= this.cellOf(view.maxX); cx++) {
      for (let cy = this.cellOf(view.minY); cy <= this.cellOf(view.maxY); cy++) {
        const bucket = this.cells.get(this.key(cx, cy))
        if (!bucket) continue

        for (const index of bucket) {
          if (seen[index]) continue
          seen[index] = 1

          const base = index * STRIDE
          const x = packed[base]!
          const y = packed[base + 1]!
          if (
            x < view.maxX &&
            x + packed[base + 2]! > view.minX &&
            y < view.maxY &&
            y + packed[base + 3]! > view.minY
          ) {
            if (found >= out.length) return found
            out[found++] = index
          }
        }
      }
    }

    return found
  }

  private cellOf(value: number): number {
    return Math.floor(value / this.cellSize)
  }

  /**
   * Cantor-style pairing into a single number key. Cheaper than string keys,
   * which would allocate on every lookup during a pan.
   */
  private key(cx: number, cy: number): number {
    const a = cx >= 0 ? cx * 2 : -cx * 2 - 1
    const b = cy >= 0 ? cy * 2 : -cy * 2 - 1
    return ((a + b) * (a + b + 1)) / 2 + b
  }
}

/** Convenience wrapper for callers that just want the visible set. */
export function visibleIndices(
  packed: Float32Array,
  count: number,
  camera: Camera,
  viewport: Viewport,
  out: Int32Array,
  padding = 200,
): number {
  'worklet'
  return cullLinear(packed, count, visibleWorldRect(camera, viewport, padding), out)
}
