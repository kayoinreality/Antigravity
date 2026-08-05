import { screenToWorldX, screenToWorldY, type Camera } from './camera'
import { STRIDE } from './culling'

/**
 * Which note is under a tap.
 *
 * Iterates the visible set backwards because that array is in paint order:
 * the last note drawn is the one on top, so it is the one the user is pointing
 * at. Getting this backwards is the classic canvas bug where clicking an
 * overlapping note selects the one underneath.
 */
export function hitTest(
  packed: Float32Array,
  visible: Int32Array,
  visibleCount: number,
  screenX: number,
  screenY: number,
  camera: Camera,
): number {
  'worklet'
  const worldX = screenToWorldX(screenX, camera)
  const worldY = screenToWorldY(screenY, camera)

  for (let i = visibleCount - 1; i >= 0; i--) {
    const index = visible[i]!
    const base = index * STRIDE
    const x = packed[base]!
    const y = packed[base + 1]!
    if (
      worldX >= x &&
      worldX <= x + packed[base + 2]! &&
      worldY >= y &&
      worldY <= y + packed[base + 3]!
    ) {
      return index
    }
  }

  return -1
}

/**
 * Hit test with a touch-sized slop.
 *
 * When zoomed out a note is only a few pixels across, and requiring a pixel
 * -perfect tap on it would make the canvas unusable at exactly the zoom level
 * where you most want to grab something. The slop is specified in *screen*
 * pixels and converted, so the forgiveness is constant to the finger.
 */
export function hitTestWithSlop(
  packed: Float32Array,
  visible: Int32Array,
  visibleCount: number,
  screenX: number,
  screenY: number,
  camera: Camera,
  slopPx = 12,
): number {
  'worklet'
  const worldX = screenToWorldX(screenX, camera)
  const worldY = screenToWorldY(screenY, camera)
  const slop = slopPx / camera.scale

  for (let i = visibleCount - 1; i >= 0; i--) {
    const index = visible[i]!
    const base = index * STRIDE
    const x = packed[base]!
    const y = packed[base + 1]!
    if (
      worldX >= x - slop &&
      worldX <= x + packed[base + 2]! + slop &&
      worldY >= y - slop &&
      worldY <= y + packed[base + 3]! + slop
    ) {
      return index
    }
  }

  return -1
}
