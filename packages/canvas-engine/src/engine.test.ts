import { describe, expect, it } from 'vitest'
import {
  centreOn,
  clampScale,
  fitBounds,
  screenToWorldX,
  screenToWorldY,
  visibleWorldRect,
  worldToScreenX,
  worldToScreenY,
  zoomAt,
  MAX_SCALE,
  MIN_SCALE,
  type Camera,
} from './camera'
import { Lod, lodForScale, lodWithHysteresis } from './lod'
import { SpatialGrid, cullLinear, packBounds } from './culling'
import { hitTest, hitTestWithSlop } from './hit-test'
import {
  BlackHoleStage,
  DEFAULT_CONFIG as BLACK_HOLE_CONFIG,
  computeVisual,
  resolveRelease,
  shouldArm,
} from './blackhole'
import { hasEscaped, layoutSystem, orbitPosition, systemBounds } from './orbit'

const VIEWPORT = { width: 400, height: 800 }
const camera = (over: Partial<Camera> = {}): Camera => ({ x: 0, y: 0, scale: 1, ...over })

describe('camera', () => {
  it('round-trips world and screen coordinates', () => {
    const cam = camera({ x: -120, y: 340, scale: 2.5 })
    const screenX = worldToScreenX(42, cam)
    const screenY = worldToScreenY(-17, cam)
    expect(screenToWorldX(screenX, cam)).toBeCloseTo(42, 9)
    expect(screenToWorldY(screenY, cam)).toBeCloseTo(-17, 9)
  })

  it('keeps the focus point fixed while zooming', () => {
    const before = camera({ x: 30, y: -60, scale: 1 })
    const focusX = 250
    const focusY = 610
    const worldX = screenToWorldX(focusX, before)
    const worldY = screenToWorldY(focusY, before)

    const after = zoomAt(before, focusX, focusY, 2.75)

    expect(worldToScreenX(worldX, after)).toBeCloseTo(focusX, 6)
    expect(worldToScreenY(worldY, after)).toBeCloseTo(focusY, 6)
  })

  it('clamps zoom to the allowed range', () => {
    expect(clampScale(1000)).toBe(MAX_SCALE)
    expect(clampScale(0.0001)).toBe(MIN_SCALE)
    expect(zoomAt(camera(), 0, 0, 99).scale).toBe(MAX_SCALE)
  })

  it('reports a visible rect that matches the viewport corners', () => {
    const cam = camera({ x: -100, y: -200, scale: 2 })
    const rect = visibleWorldRect(cam, VIEWPORT)
    expect(rect.minX).toBeCloseTo(screenToWorldX(0, cam), 9)
    expect(rect.minY).toBeCloseTo(screenToWorldY(0, cam), 9)
    expect(rect.maxX).toBeCloseTo(screenToWorldX(VIEWPORT.width, cam), 9)
    expect(rect.maxY).toBeCloseTo(screenToWorldY(VIEWPORT.height, cam), 9)
  })

  it('grows the visible rect by the padding, in world units', () => {
    const cam = camera({ scale: 2 })
    const plain = visibleWorldRect(cam, VIEWPORT)
    const padded = visibleWorldRect(cam, VIEWPORT, 100)
    expect(plain.minX - padded.minX).toBeCloseTo(50, 9) // 100px / scale 2
  })

  it('centres the framed bounds in the viewport', () => {
    const bounds = { minX: 1000, minY: 2000, maxX: 1400, maxY: 2300 }
    const cam = fitBounds(bounds, VIEWPORT)
    expect(worldToScreenX(1200, cam)).toBeCloseTo(VIEWPORT.width / 2, 6)
    expect(worldToScreenY(2150, cam)).toBeCloseTo(VIEWPORT.height / 2, 6)
  })

  it('does not zoom past maxScale when framing something tiny', () => {
    const cam = fitBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, VIEWPORT, { maxScale: 1.1 })
    expect(cam.scale).toBeCloseTo(1.1, 9)
  })

  it('keeps the whole rect on screen when framing something huge', () => {
    const bounds = { minX: -5000, minY: -5000, maxX: 5000, maxY: 5000 }
    const cam = fitBounds(bounds, VIEWPORT, { padding: 40 })
    expect(worldToScreenX(bounds.minX, cam)).toBeGreaterThanOrEqual(0)
    expect(worldToScreenX(bounds.maxX, cam)).toBeLessThanOrEqual(VIEWPORT.width)
  })

  it('centres a point without touching the zoom', () => {
    const cam = centreOn(500, -300, VIEWPORT, 1.75)
    expect(cam.scale).toBe(1.75)
    expect(worldToScreenX(500, cam)).toBeCloseTo(VIEWPORT.width / 2, 9)
    expect(worldToScreenY(-300, cam)).toBeCloseTo(VIEWPORT.height / 2, 9)
  })
})

describe('level of detail', () => {
  it('drops to stars when zoomed far out and shows full cards up close', () => {
    expect(lodForScale(0.1)).toBe(Lod.Star)
    expect(lodForScale(0.5)).toBe(Lod.Card)
    expect(lodForScale(1)).toBe(Lod.Full)
  })

  it('holds the previous level inside the hysteresis band', () => {
    // Sitting just past the star/card boundary must not flip every frame.
    expect(lodWithHysteresis(0.36, Lod.Star)).toBe(Lod.Star)
    expect(lodWithHysteresis(0.34, Lod.Card)).toBe(Lod.Card)
  })

  it('switches once the scale clears the band', () => {
    expect(lodWithHysteresis(0.45, Lod.Star)).toBe(Lod.Card)
    expect(lodWithHysteresis(0.2, Lod.Card)).toBe(Lod.Star)
  })
})

describe('culling', () => {
  const notes = [
    { x: 0, y: 0, width: 200, height: 132 },
    { x: 5000, y: 5000, width: 200, height: 132 },
    { x: -300, y: -300, width: 200, height: 132 },
  ]
  const packed = packBounds(notes)

  it('returns only the rects intersecting the view', () => {
    const out = new Int32Array(16)
    const found = cullLinear(packed, notes.length, { minX: -50, minY: -50, maxX: 250, maxY: 250 }, out)
    expect(found).toBe(1)
    expect(out[0]).toBe(0)
  })

  it('includes a rect that only partially overlaps', () => {
    const out = new Int32Array(16)
    const found = cullLinear(packed, notes.length, { minX: -200, minY: -200, maxX: -150, maxY: -150 }, out)
    expect(found).toBe(1)
    expect(out[0]).toBe(2)
  })

  it('returns nothing for an empty region', () => {
    const out = new Int32Array(16)
    expect(cullLinear(packed, notes.length, { minX: 1000, minY: 1000, maxX: 1100, maxY: 1100 }, out)).toBe(0)
  })

  it('stops at the capacity of the output buffer instead of overflowing', () => {
    const many = packBounds(Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0, width: 10, height: 10 })))
    const out = new Int32Array(8)
    expect(cullLinear(many, 50, { minX: -100, minY: -100, maxX: 1000, maxY: 1000 }, out)).toBe(8)
  })

  it('grid and linear scan agree', () => {
    const random = Array.from({ length: 400 }, (_, i) => ({
      x: ((i * 7919) % 4000) - 2000,
      y: ((i * 104729) % 4000) - 2000,
      width: 200,
      height: 132,
    }))
    const packedRandom = packBounds(random)
    const view = { minX: -500, minY: -500, maxX: 500, maxY: 500 }

    const linearOut = new Int32Array(400)
    const linearCount = cullLinear(packedRandom, random.length, view, linearOut)

    const grid = new SpatialGrid(512)
    grid.build(packedRandom, random.length)
    const gridOut = new Int32Array(400)
    const gridCount = grid.query(packedRandom, view, gridOut, new Uint8Array(400))

    const asSet = (arr: Int32Array, n: number) => new Set(Array.from(arr.slice(0, n)))
    expect(gridCount).toBe(linearCount)
    expect(asSet(gridOut, gridCount)).toEqual(asSet(linearOut, linearCount))
  })

  it('reports a note straddling cell borders exactly once', () => {
    const straddling = packBounds([{ x: 500 - 100, y: 500 - 66, width: 200, height: 132 }])
    const grid = new SpatialGrid(512)
    grid.build(straddling, 1)
    const out = new Int32Array(4)
    expect(grid.query(straddling, { minX: 0, minY: 0, maxX: 2000, maxY: 2000 }, out, new Uint8Array(1))).toBe(1)
  })
})

describe('hit testing', () => {
  const packed = packBounds([
    { x: 0, y: 0, width: 200, height: 132 },
    { x: 100, y: 60, width: 200, height: 132 },
  ])
  const visible = Int32Array.from([0, 1])

  it('picks the topmost note when two overlap', () => {
    // (150, 90) is inside both; index 1 is painted later, so it wins.
    expect(hitTest(packed, visible, 2, 150, 90, camera())).toBe(1)
  })

  it('returns -1 on empty space', () => {
    expect(hitTest(packed, visible, 2, 900, 900, camera())).toBe(-1)
  })

  it('respects the camera transform', () => {
    // Panned so world (150, 90) — inside note 1 — sits at screen (1150, 1090).
    const cam = camera({ x: 1000, y: 1000, scale: 1 })
    expect(hitTest(packed, visible, 2, 50, 50, cam)).toBe(-1)
    expect(hitTest(packed, visible, 2, 1150, 1090, cam)).toBe(1)
  })

  it('keeps the slop constant in screen pixels as zoom changes', () => {
    const zoomedOut = camera({ scale: 0.1 })
    // 10px to the left of the note edge in screen space, at any zoom.
    const justOutside = worldToScreenX(0, zoomedOut) - 10
    expect(hitTest(packed, visible, 2, justOutside, worldToScreenY(60, zoomedOut), zoomedOut)).toBe(-1)
    expect(hitTestWithSlop(packed, visible, 2, justOutside, worldToScreenY(60, zoomedOut), zoomedOut, 12)).toBe(0)
  })
})

describe('black hole', () => {
  const drag = (over: Partial<{ x: number; y: number; translationY: number; velocityY: number }> = {}) => ({
    x: 200,
    y: 400,
    translationY: 0,
    velocityY: 0,
    ...over,
  })

  it('does not arm on a slow deliberate drag upward', () => {
    expect(shouldArm(drag({ translationY: -400, velocityY: -50 }), VIEWPORT.height, BLACK_HOLE_CONFIG)).toBe(false)
  })

  it('does not arm on a fast flick that barely moved', () => {
    expect(shouldArm(drag({ translationY: -20, velocityY: -900 }), VIEWPORT.height, BLACK_HOLE_CONFIG)).toBe(false)
  })

  it('arms on a fast upward flick that covered distance', () => {
    expect(shouldArm(drag({ translationY: -200, velocityY: -600 }), VIEWPORT.height, BLACK_HOLE_CONFIG)).toBe(true)
  })

  it('never arms on a downward drag, however fast', () => {
    expect(shouldArm(drag({ translationY: 400, velocityY: 900 }), VIEWPORT.height, BLACK_HOLE_CONFIG)).toBe(false)
  })

  it('leaves the note alone before it is armed', () => {
    const visual = computeVisual(BlackHoleStage.Dragging, drag(), VIEWPORT.width, VIEWPORT.height, 1)
    expect(visual.pull).toBe(0)
    expect(visual.noteX).toBe(200)
    expect(visual.stretch).toBe(1)
  })

  it('pulls the note toward the singularity as it approaches', () => {
    const far = computeVisual(BlackHoleStage.Armed, drag({ y: 500 }), VIEWPORT.width, VIEWPORT.height, 1)
    const near = computeVisual(BlackHoleStage.Armed, drag({ y: 180 }), VIEWPORT.width, VIEWPORT.height, 1)
    expect(near.pull).toBeGreaterThan(far.pull)
    expect(near.noteY).toBeLessThan(180)
  })

  it('stretches the note more the closer it gets', () => {
    const far = computeVisual(BlackHoleStage.Armed, drag({ y: 500 }), VIEWPORT.width, VIEWPORT.height, 1)
    const near = computeVisual(BlackHoleStage.Armed, drag({ y: 160 }), VIEWPORT.width, VIEWPORT.height, 1)
    expect(near.stretch).toBeGreaterThan(far.stretch)
    expect(near.squeeze).toBeLessThan(far.squeeze)
  })

  it('never inverts the note while squeezing', () => {
    const atCentre = computeVisual(
      BlackHoleStage.Armed,
      drag({ x: 200, y: VIEWPORT.height * BLACK_HOLE_CONFIG.centreYRatio }),
      VIEWPORT.width,
      VIEWPORT.height,
      1,
    )
    expect(atCentre.squeeze).toBeGreaterThan(0)
  })

  it('scales the whole effect by presence, so it fades in rather than popping', () => {
    const half = computeVisual(BlackHoleStage.Armed, drag({ y: 200 }), VIEWPORT.width, VIEWPORT.height, 0.5)
    const full = computeVisual(BlackHoleStage.Armed, drag({ y: 200 }), VIEWPORT.width, VIEWPORT.height, 1)
    expect(half.pull).toBeLessThan(full.pull)
  })

  it('flags capture only inside the event horizon', () => {
    const cy = VIEWPORT.height * BLACK_HOLE_CONFIG.centreYRatio
    const inside = computeVisual(BlackHoleStage.Armed, drag({ x: 200, y: cy + 40 }), VIEWPORT.width, VIEWPORT.height, 1)
    const outside = computeVisual(BlackHoleStage.Armed, drag({ x: 200, y: cy + 300 }), VIEWPORT.width, VIEWPORT.height, 1)
    expect(inside.willCapture).toBe(true)
    expect(outside.willCapture).toBe(false)
  })

  it('deletes on release inside the horizon and springs back outside it', () => {
    const cy = VIEWPORT.height * BLACK_HOLE_CONFIG.centreYRatio
    expect(resolveRelease(drag({ x: 200, y: cy }), VIEWPORT.width, VIEWPORT.height, BlackHoleStage.Armed))
      .toBe(BlackHoleStage.Captured)
    expect(resolveRelease(drag({ x: 200, y: cy + 400 }), VIEWPORT.width, VIEWPORT.height, BlackHoleStage.Armed))
      .toBe(BlackHoleStage.Idle)
  })

  it('cannot delete from an unarmed drag even over the singularity', () => {
    const cy = VIEWPORT.height * BLACK_HOLE_CONFIG.centreYRatio
    expect(resolveRelease(drag({ x: 200, y: cy }), VIEWPORT.width, VIEWPORT.height, BlackHoleStage.Dragging))
      .toBe(BlackHoleStage.Idle)
  })
})

describe('orbit layout', () => {
  const members = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      noteId: `n${i}`,
      affinity: 1 - i * 0.01,
      createdAt: 1000 + i,
    }))

  it('places every member exactly once', () => {
    const slots = layoutSystem(members(12), 0, 0)
    expect(slots).toHaveLength(12)
    expect(new Set(slots.map((s) => s.noteId)).size).toBe(12)
  })

  it('puts the highest-affinity notes on the innermost ring', () => {
    const slots = layoutSystem(members(20), 0, 0)
    const inner = slots.filter((s) => s.ring === 0).map((s) => s.noteId)
    expect(inner).toContain('n0')
    expect(inner).not.toContain('n19')
  })

  it('never overlaps two notes', () => {
    const slots = layoutSystem(members(40), 0, 0)
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i]!
        const b = slots[j]!
        const overlaps =
          a.x < b.x + 200 && a.x + 200 > b.x && a.y < b.y + 132 && a.y + 132 > b.y
        expect(overlaps).toBe(false)
      }
    }
  })

  it('is stable — the same members lay out identically twice', () => {
    expect(layoutSystem(members(15), 100, 200)).toEqual(layoutSystem(members(15), 100, 200))
  })

  it('keeps existing notes on their ring when a less relevant one joins', () => {
    // The newcomer ranks last, so it lands on the outside. Ring members re-flow
    // to stay evenly spaced, but nobody is promoted or demoted.
    const before = layoutSystem(members(9), 0, 0)
    const after = layoutSystem([...members(9), { noteId: 'newcomer', affinity: 0.1, createdAt: 9999 }], 0, 0)

    for (const slot of before) {
      expect(after.find((s) => s.noteId === slot.noteId)!.ring).toBe(slot.ring)
    }
    expect(after.find((s) => s.noteId === 'newcomer')!.ring).toBeGreaterThan(0)
  })

  it('handles a single-note system', () => {
    expect(layoutSystem(members(1), 0, 0)).toHaveLength(1)
  })

  it('returns nothing for an empty system', () => {
    expect(layoutSystem([], 0, 0)).toEqual([])
    expect(systemBounds([])).toBeNull()
  })

  it('agrees with orbitPosition when the star moves', () => {
    const slot = layoutSystem(members(6), 0, 0)[3]!
    const moved = orbitPosition(500, -400, slot.radius, slot.angle)
    expect(moved.x).toBeCloseTo(slot.x + 500, 6)
    expect(moved.y).toBeCloseTo(slot.y - 400, 6)
  })

  it('detects escape only past the multiplier, scaled to the orbit', () => {
    expect(hasEscaped(300, 0, 0, 0, 200)).toBe(false) // 1.5x
    expect(hasEscaped(340, 0, 0, 0, 200)).toBe(true) // 1.7x
    // A tight inner orbit needs less absolute travel to break free.
    expect(hasEscaped(100, 0, 0, 0, 50)).toBe(true)
  })
})
