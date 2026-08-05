import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BLACK_HOLE_CONFIG,
  BlackHoleStage,
  computeVisual,
  cullLinear,
  fitBounds,
  hasEscaped,
  hitTestWithSlop,
  packBounds,
  resolveRelease,
  screenToWorldX,
  screenToWorldY,
  shouldArm,
  visibleWorldRect,
  zoomAt,
  type BlackHoleVisual,
  type Camera,
} from '@antigravity/canvas-engine'
import {
  NOTE_HEIGHT,
  NOTE_WIDTH,
  resultsBounds,
  type Note,
  type NoteLink,
  type NoteSystem,
} from '@antigravity/core'
import { useStore } from '../state/store'
import { invalidateWrap, render, type RenderState } from './renderer'

/**
 * The canvas surface and every pointer interaction on it.
 *
 * State that changes per frame (camera, drag position, black hole) lives in
 * refs, not React state: a pan at 120Hz would otherwise be 120 renders a second
 * of a component tree that produces no DOM. React owns what the user sees
 * *around* the canvas; the canvas owns its own frame loop.
 */

const ZOOM_SENSITIVITY = 0.0016

/**
 * Everything the frame loop reads and the pointer handlers write.
 *
 * Declared explicitly rather than inferred from the initializer so the typed
 * arrays keep their general `ArrayBufferLike` form — inference from
 * `new Float32Array(0)` narrows them to `ArrayBuffer` and then rejects the
 * buffers `packBounds` hands back.
 */
interface FrameState {
  notes: Note[]
  systems: NoteSystem[]
  links: NoteLink[]
  selectedId: string | null
  matched: Set<string> | null
  packed: Float32Array
  visible: Int32Array
  visibleCount: number
  draggingId: string | null
  dragStart: { x: number; y: number }
  dragOrigin: { x: number; y: number }
  lastPointer: { x: number; y: number; t: number }
  velocityY: number
  stage: BlackHoleStage
  presence: number
  blackHole: BlackHoleVisual | null
  panning: boolean
  panStart: { x: number; y: number }
  cameraStart: { x: number; y: number }
  startedAt: number
  /** Where each note was last drawn, so a jump can be detected and smoothed. */
  rendered: Map<string, { x: number; y: number }>
  tweens: Map<string, Tween>
}

interface Tween {
  fromX: number
  fromY: number
  toX: number
  toY: number
  startAt: number
  duration: number
}

/** Travel distance, in world units, above which a move is animated. */
const TWEEN_THRESHOLD = 60
const TWEEN_DURATION = 620

/** Ease-out-back: overshoots slightly, so a note settles into orbit. */
function easeOutBack(t: number): number {
  const c1 = 1.24
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

export function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cameraRef = useRef<Camera>({ x: 0, y: 0, scale: 1 })
  const [cursor, setCursor] = useState<'grab' | 'grabbing' | 'pointer'>('grab')

  const notes = useStore((s) => s.notes)
  const systems = useStore((s) => s.systems)
  const links = useStore((s) => s.links)
  const selectedId = useStore((s) => s.selectedId)
  const search = useStore((s) => s.search)
  const addNote = useStore((s) => s.addNote)
  const moveNote = useStore((s) => s.moveNote)
  const removeNote = useStore((s) => s.removeNote)
  const select = useStore((s) => s.select)
  const openEditor = useStore((s) => s.openEditor)
  const detachFromSystem = useStore((s) => s.detachFromSystem)
  const focusBounds = useStore((s) => s.focusBounds)
  const clearFocus = useStore((s) => s.clearFocus)

  // Mutable frame state. Written by pointer handlers, read by the render loop.
  const frame = useRef<FrameState>({
    notes,
    systems,
    links,
    selectedId,
    matched: null as Set<string> | null,
    packed: new Float32Array(0),
    visible: new Int32Array(0),
    visibleCount: 0,
    draggingId: null as string | null,
    dragStart: { x: 0, y: 0 },
    dragOrigin: { x: 0, y: 0 },
    lastPointer: { x: 0, y: 0, t: 0 },
    velocityY: 0,
    stage: BlackHoleStage.Idle,
    presence: 0,
    blackHole: null as BlackHoleVisual | null,
    panning: false,
    panStart: { x: 0, y: 0 },
    cameraStart: { x: 0, y: 0 },
    startedAt: performance.now(),
    rendered: new Map(),
    tweens: new Map(),
  })

  // Keep the frame's view of the data current without re-creating the loop.
  //
  // This is also where movement animations start. Rather than plumbing an
  // explicit "animate these notes" event down from every action that relocates
  // something, the canvas notices that a note's stored position jumped away
  // from where it was last drawn and animates the difference. Orbital
  // insertion, escaping a system and any future re-layout all get the same
  // treatment for free; a drag does not, because the dragged note is excluded.
  useEffect(() => {
    const state = frame.current
    const now = performance.now()
    let staggered = 0

    for (const note of notes) {
      const last = state.rendered.get(note.id)
      if (!last || note.id === state.draggingId) continue

      const dx = note.x - last.x
      const dy = note.y - last.y
      if (Math.hypot(dx, dy) < TWEEN_THRESHOLD) continue

      state.tweens.set(note.id, {
        fromX: last.x,
        fromY: last.y,
        toX: note.x,
        toY: note.y,
        // Stagger so a system assembles rather than snapping into place at once.
        startAt: now + staggered * 45,
        duration: TWEEN_DURATION,
      })
      staggered += 1
    }

    state.notes = notes
    state.packed = packBounds(
      notes.map((n) => ({ x: n.x, y: n.y, width: NOTE_WIDTH, height: NOTE_HEIGHT })),
    )
    if (state.visible.length < notes.length) {
      state.visible = new Int32Array(Math.max(64, notes.length))
    }
  }, [notes])

  useEffect(() => {
    frame.current.systems = systems
    frame.current.links = links
    frame.current.selectedId = selectedId
  }, [systems, links, selectedId])

  useEffect(() => {
    frame.current.matched = search ? search.matched : null
  }, [search])

  // Framing the results is what makes search feel like it moved you somewhere,
  // rather than just filtering a list you then have to go find.
  useEffect(() => {
    if (!search || search.results.length === 0) return
    const canvas = canvasRef.current
    if (!canvas) return

    const bounds = resultsBounds(
      search.results,
      new Map(notes.map((n) => [n.id, n])),
      NOTE_WIDTH,
      NOTE_HEIGHT,
    )
    if (!bounds) return

    cameraRef.current = fitBounds(bounds, {
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // A newly formed system is off-screen as often as not — it lays out around
  // the cluster's centroid, not around wherever the camera happens to be. Frame
  // it, or the user accepts a suggestion and appears to watch nothing happen.
  useEffect(() => {
    if (!focusBounds) return
    const canvas = canvasRef.current
    if (!canvas) return

    cameraRef.current = fitBounds(focusBounds, {
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    }, { padding: 130, maxScale: 0.95 })
    clearFocus()
  }, [focusBounds, clearFocus])

  // ---------------------------------------------------------------- rendering

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    let running = true

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(canvas.clientWidth * dpr)
      canvas.height = Math.floor(canvas.clientHeight * dpr)
    }
    resize()
    window.addEventListener('resize', resize)

    const loop = () => {
      if (!running) return

      const state = frame.current
      const viewport = { width: canvas.clientWidth, height: canvas.clientHeight }
      const camera = cameraRef.current

      state.visibleCount = cullLinear(
        state.packed,
        state.notes.length,
        visibleWorldRect(camera, viewport, 240),
        state.visible,
      )

      // Presence eases in and out so the singularity materialises over a few
      // frames instead of appearing between one frame and the next.
      const target = state.stage >= BlackHoleStage.Armed ? 1 : 0
      state.presence += (target - state.presence) * 0.14
      if (state.presence < 0.002) state.presence = 0

      // Advance any in-flight movement, and record where everything ended up
      // so the next data change can tell a jump from a normal edit.
      const now = performance.now()
      const positions = new Map<string, { x: number; y: number }>()

      for (const note of state.notes) {
        const tween = state.tweens.get(note.id)
        if (!tween) {
          state.rendered.set(note.id, { x: note.x, y: note.y })
          continue
        }

        const elapsed = now - tween.startAt
        if (elapsed >= tween.duration) {
          state.tweens.delete(note.id)
          state.rendered.set(note.id, { x: note.x, y: note.y })
          continue
        }

        const t = elapsed <= 0 ? 0 : easeOutBack(elapsed / tween.duration)
        const point = {
          x: tween.fromX + (tween.toX - tween.fromX) * t,
          y: tween.fromY + (tween.toY - tween.fromY) * t,
        }
        positions.set(note.id, point)
        state.rendered.set(note.id, point)
      }

      const renderState: RenderState = {
        camera,
        viewport,
        notes: state.notes,
        visible: state.visible,
        visibleCount: state.visibleCount,
        systems: state.systems,
        links: state.links,
        selectedId: state.selectedId,
        matched: state.matched,
        draggingId: state.draggingId,
        blackHole: state.blackHole,
        positions: positions.size > 0 ? positions : null,
        elapsed: now - state.startedAt,
      }

      render(ctx, renderState)
      requestAnimationFrame(loop)
    }

    requestAnimationFrame(loop)

    return () => {
      running = false
      window.removeEventListener('resize', resize)
    }
  }, [])

  // ------------------------------------------------------------- interactions

  const pointAt = useCallback((event: React.PointerEvent | React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }, [])

  const noteAt = useCallback(
    (x: number, y: number): number =>
      hitTestWithSlop(
        frame.current.packed,
        frame.current.visible,
        frame.current.visibleCount,
        x,
        y,
        cameraRef.current,
      ),
    [],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const point = pointAt(event)
      const state = frame.current
      const index = noteAt(point.x, point.y)

      canvasRef.current?.setPointerCapture(event.pointerId)

      if (index >= 0) {
        const note = state.notes[index]!
        state.draggingId = note.id
        state.dragStart = point
        state.dragOrigin = { x: note.x, y: note.y }
        state.lastPointer = { x: point.x, y: point.y, t: performance.now() }
        state.velocityY = 0
        state.stage = BlackHoleStage.Dragging
        select(note.id)
        setCursor('grabbing')
        return
      }

      state.panning = true
      state.panStart = point
      state.cameraStart = { x: cameraRef.current.x, y: cameraRef.current.y }
      select(null)
      setCursor('grabbing')
    },
    [noteAt, pointAt, select],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const point = pointAt(event)
      const state = frame.current
      const canvas = canvasRef.current!
      const viewport = { width: canvas.clientWidth, height: canvas.clientHeight }

      if (state.panning) {
        cameraRef.current = {
          ...cameraRef.current,
          x: state.cameraStart.x + (point.x - state.panStart.x),
          y: state.cameraStart.y + (point.y - state.panStart.y),
        }
        return
      }

      if (!state.draggingId) {
        setCursor(noteAt(point.x, point.y) >= 0 ? 'pointer' : 'grab')
        return
      }

      const now = performance.now()
      const dt = Math.max(1, now - state.lastPointer.t)
      // Smoothed so a single jittery sample cannot arm the black hole.
      state.velocityY = state.velocityY * 0.6 + ((point.y - state.lastPointer.y) / dt) * 1000 * 0.4
      state.lastPointer = { x: point.x, y: point.y, t: now }

      const translationY = point.y - state.dragStart.y

      if (
        state.stage === BlackHoleStage.Dragging &&
        shouldArm(
          { x: point.x, y: point.y, translationY, velocityY: state.velocityY },
          viewport.height,
          BLACK_HOLE_CONFIG,
        )
      ) {
        state.stage = BlackHoleStage.Armed
      }

      state.blackHole = computeVisual(
        state.stage,
        { x: point.x, y: point.y, translationY, velocityY: state.velocityY },
        viewport.width,
        viewport.height,
        state.presence,
      )

      // While armed the black hole owns the note's position, so writing the
      // pointer position back to the store would fight the gravity animation.
      if (state.stage < BlackHoleStage.Armed) {
        const scale = cameraRef.current.scale
        moveNote(
          state.draggingId,
          state.dragOrigin.x + (point.x - state.dragStart.x) / scale,
          state.dragOrigin.y + (point.y - state.dragStart.y) / scale,
        )
      }
    },
    [moveNote, noteAt, pointAt],
  )

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const point = pointAt(event)
      const state = frame.current
      const canvas = canvasRef.current!
      canvas.releasePointerCapture(event.pointerId)

      if (state.panning) {
        state.panning = false
        setCursor('grab')
        return
      }

      const draggingId = state.draggingId
      if (!draggingId) return

      const outcome = resolveRelease(
        {
          x: point.x,
          y: point.y,
          translationY: point.y - state.dragStart.y,
          velocityY: state.velocityY,
        },
        canvas.clientWidth,
        canvas.clientHeight,
        state.stage,
      )

      if (outcome === BlackHoleStage.Captured) {
        removeNote(draggingId)
      } else if (state.stage >= BlackHoleStage.Armed) {
        // Released outside the horizon: the note goes back where it started,
        // because while armed we stopped writing its position.
        moveNote(draggingId, state.dragOrigin.x, state.dragOrigin.y)
      } else {
        const note = state.notes.find((n) => n.id === draggingId)
        const system = note?.systemId
          ? state.systems.find((s) => s.id === note.systemId)
          : undefined

        if (note && system && note.orbitRadius !== null) {
          const escaped = hasEscaped(
            note.x + NOTE_WIDTH / 2,
            note.y + NOTE_HEIGHT / 2,
            system.centroidX,
            system.centroidY,
            note.orbitRadius,
          )
          if (escaped) detachFromSystem(note.id)
        }
      }

      state.draggingId = null
      state.stage = BlackHoleStage.Idle
      state.blackHole = null
      setCursor('grab')
    },
    [detachFromSystem, moveNote, pointAt, removeNote],
  )

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const point = pointAt(event)
      const index = noteAt(point.x, point.y)

      if (index >= 0) {
        const note = frame.current.notes[index]!
        invalidateWrap(note.id)
        openEditor(note.id)
        return
      }

      addNote(
        screenToWorldX(point.x, cameraRef.current),
        screenToWorldY(point.y, cameraRef.current),
      )
    },
    [addNote, noteAt, openEditor, pointAt],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Registered natively rather than via React's onWheel because the listener
    // has to be non-passive to preventDefault, which React does not allow.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      if (event.ctrlKey || event.metaKey || Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        const factor = Math.exp(-event.deltaY * ZOOM_SENSITIVITY)
        cameraRef.current = zoomAt(cameraRef.current, x, y, cameraRef.current.scale * factor)
      } else {
        cameraRef.current = {
          ...cameraRef.current,
          x: cameraRef.current.x - event.deltaX,
          y: cameraRef.current.y - event.deltaY,
        }
      }
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="canvas"
      style={{ cursor }}
      data-testid="canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    />
  )
}
