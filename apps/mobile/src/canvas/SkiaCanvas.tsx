import { useCallback, useEffect, useMemo } from 'react'
import { StyleSheet, useWindowDimensions } from 'react-native'
import { Canvas, Picture, Skia, createPicture, type SkPicture } from '@shopify/react-native-skia'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import {
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import * as Haptics from 'expo-haptics'
import {
  BLACK_HOLE_CONFIG,
  BlackHoleStage,
  Lod,
  clampScale,
  computeVisual,
  cullLinear,
  hasEscaped,
  hitTestWithSlop,
  lodForScale,
  packBounds,
  resolveRelease,
  screenToWorldX,
  screenToWorldY,
  shouldArm,
  singularityX,
  singularityY,
  visibleWorldRect,
  type Camera,
} from '@antigravity/canvas-engine'
import { NOTE_HEIGHT, NOTE_WIDTH, darkColors, type Note } from '@antigravity/core'
import { useStore } from '../state/store'
import { picturesFor, pictureForLod, type NotePictures } from './note-pictures'

/**
 * The Skia canvas.
 *
 * The whole surface is ONE native view holding ONE picture, rebuilt each frame
 * on the UI thread from the camera and the visible set. That is the difference
 * from the previous build, which mounted a native view per note inside an
 * 8000x8000 container: there, a thousand notes meant roughly five thousand
 * views, all live, all being laid out. Here a thousand notes is a thousand
 * entries in a Float32Array and about eighty draw calls.
 *
 * Pan, pinch and the delete gesture never touch the JS thread. The camera lives
 * in shared values, the culling and hit-testing are worklets over packed typed
 * arrays, and JS only hears about the outcome — a note moved, a note deleted.
 */

interface Props {
  onOpenEditor: (noteId: string) => void
}

export function SkiaCanvas({ onOpenEditor }: Props) {
  const { width, height } = useWindowDimensions()

  const notes = useStore((s) => s.notes)
  const systems = useStore((s) => s.systems)
  const links = useStore((s) => s.links)
  const selectedId = useStore((s) => s.selectedId)
  const matchedIds = useStore((s) => s.search?.matched ?? null)
  const addNote = useStore((s) => s.addNote)
  const moveNote = useStore((s) => s.moveNote)
  const removeNote = useStore((s) => s.removeNote)
  const select = useStore((s) => s.select)
  const detachFromSystem = useStore((s) => s.detachFromSystem)

  // ------------------------------------------------------------------ camera
  const cameraX = useSharedValue(width / 2)
  const cameraY = useSharedValue(height / 2)
  const scale = useSharedValue(1)
  const savedX = useSharedValue(0)
  const savedY = useSharedValue(0)
  const savedScale = useSharedValue(1)

  // ------------------------------------------------------- drag / black hole
  const draggingIndex = useSharedValue(-1)
  const dragX = useSharedValue(0)
  const dragY = useSharedValue(0)
  const dragOriginX = useSharedValue(0)
  const dragOriginY = useSharedValue(0)
  const dragStartX = useSharedValue(0)
  const dragStartY = useSharedValue(0)
  const stage = useSharedValue<BlackHoleStage>(BlackHoleStage.Idle)
  const presence = useSharedValue(0)
  const clock = useSharedValue(0)

  /**
   * Geometry and appearance, packed into forms a worklet can read without
   * touching a JS object. `bounds` is x/y/w/h per note; `pictures` is a plain
   * array of Skia host objects, which cross the boundary intact.
   */
  const bounds = useSharedValue<Float32Array>(new Float32Array(0))
  const pictures = useSharedValue<NotePictures[]>([])
  const dimmed = useSharedValue<Float32Array>(new Float32Array(0))
  const selectedIndex = useSharedValue(-1)
  const visible = useSharedValue<Int32Array>(new Int32Array(64))
  const noteCount = useSharedValue(0)

  useEffect(() => {
    bounds.value = packBounds(
      notes.map((n) => ({ x: n.x, y: n.y, width: NOTE_WIDTH, height: NOTE_HEIGHT })),
    )
    // Recording happens here, on the JS thread, and only for notes whose text
    // actually changed — `picturesFor` returns the cached pair otherwise.
    pictures.value = notes.map(picturesFor)
    noteCount.value = notes.length
    if (visible.value.length < notes.length) {
      visible.value = new Int32Array(Math.max(64, notes.length))
    }
  }, [notes, bounds, pictures, noteCount, visible])

  useEffect(() => {
    // Spotlight state as a parallel array: 1 means "dim, not a search result".
    const flags = new Float32Array(notes.length)
    if (matchedIds) {
      for (let i = 0; i < notes.length; i++) {
        flags[i] = matchedIds.has(notes[i]!.id) ? 0 : 1
      }
    }
    dimmed.value = flags
  }, [notes, matchedIds, dimmed])

  useEffect(() => {
    selectedIndex.value = selectedId ? notes.findIndex((n) => n.id === selectedId) : -1
  }, [selectedId, notes, selectedIndex])

  // Orbit rings and links change rarely, so they are pre-recorded into a single
  // picture in world coordinates rather than rebuilt every frame.
  const staticPicture = useMemo(
    () => recordStaticLayer(notes, systems, links),
    [notes, systems, links],
  )

  useEffect(() => {
    const id = setInterval(() => {
      clock.value += 16
    }, 16)
    return () => clearInterval(id)
  }, [clock])

  // ---------------------------------------------------------------- the frame
  const framePicture = useDerivedValue<SkPicture>(() => {
    const camera: Camera = { x: cameraX.value, y: cameraY.value, scale: scale.value }
    const viewport = { width, height }

    return createPicture((canvas) => {
      'worklet'
      const count = cullLinear(
        bounds.value,
        noteCount.value,
        visibleWorldRect(camera, viewport, 240),
        visible.value,
      )

      const lod = lodForScale(camera.scale)

      canvas.save()
      canvas.translate(camera.x, camera.y)
      canvas.scale(camera.scale, camera.scale)

      const linkPaint = Skia.Paint()
      linkPaint.setAntiAlias(true)
      canvas.drawPicture(staticPicture)

      const starPaint = Skia.Paint()
      starPaint.setAntiAlias(true)

      const dimPaint = Skia.Paint()
      dimPaint.setAlphaf(0.12)

      for (let i = 0; i < count; i++) {
        const index = visible.value[i]!
        if (index === draggingIndex.value) continue

        const base = index * 4
        const x = bounds.value[base]!
        const y = bounds.value[base + 1]!
        const isDim = dimmed.value[index] === 1

        // Below the star threshold, or dimmed out of a search, a note is a
        // point of light. Cheaper to draw, and it keeps the shape of the canvas
        // legible instead of blanking it.
        if (lod === Lod.Star || isDim) {
          starPaint.setAlphaf(isDim ? 0.28 : 0.85)
          canvas.drawCircle(x + NOTE_WIDTH / 2, y + NOTE_HEIGHT / 2, 4 / camera.scale, starPaint)
          continue
        }

        canvas.save()
        canvas.translate(x, y)
        canvas.drawPicture(pictureForLod(pictures.value[index]!, lod))

        if (index === selectedIndex.value) {
          const ring = Skia.Paint()
          ring.setStyle(1) // stroke
          ring.setStrokeWidth(2.5 / camera.scale)
          ring.setColor(Skia.Color('#FFFFFF'))
          ring.setAntiAlias(true)
          canvas.drawRRect(
            Skia.RRectXY(Skia.XYWHRect(0, 0, NOTE_WIDTH, NOTE_HEIGHT), 16, 16),
            ring,
          )
        }

        canvas.restore()
      }

      canvas.restore()

      // The dragged note and the singularity are drawn in *screen* space: both
      // are anchored to the device, not to the world.
      if (draggingIndex.value >= 0) {
        drawDragged(canvas, {
          index: draggingIndex.value,
          bounds: bounds.value,
          pictures: pictures.value,
          camera,
          viewport,
          stage: stage.value,
          presence: presence.value,
          dragX: dragX.value,
          dragY: dragY.value,
          dragStartY: dragStartY.value,
          lod,
        })
      }

      if (presence.value > 0.002) {
        drawSingularity(canvas, viewport, presence.value, clock.value, {
          x: dragX.value,
          y: dragY.value,
        })
      }
    })
    // `staticPicture` is a plain value captured by the worklet's closure, so it
    // has to be declared: without it the frame would keep replaying the picture
    // recorded before the last link or system change.
  }, [staticPicture, width, height])

  // -------------------------------------------------------------- interaction

  const handleTap = useCallback(
    (index: number) => {
      select(index >= 0 ? (notes[index]?.id ?? null) : null)
    },
    [notes, select],
  )

  const handleDoubleTapNote = useCallback(
    (index: number) => {
      const note = notes[index]
      if (note) onOpenEditor(note.id)
    },
    [notes, onOpenEditor],
  )

  const handleCreate = useCallback(
    (worldX: number, worldY: number) => {
      const id = addNote(worldX, worldY)
      onOpenEditor(id)
    },
    [addNote, onOpenEditor],
  )

  const handleDrop = useCallback(
    (index: number, x: number, y: number) => {
      const note = notes[index]
      if (!note) return

      moveNote(note.id, x, y)

      if (note.systemId && note.orbitRadius !== null) {
        const system = systems.find((s) => s.id === note.systemId)
        if (
          system &&
          hasEscaped(
            x + NOTE_WIDTH / 2,
            y + NOTE_HEIGHT / 2,
            system.centroidX,
            system.centroidY,
            note.orbitRadius,
          )
        ) {
          detachFromSystem(note.id)
        }
      }
    },
    [notes, systems, moveNote, detachFromSystem],
  )

  const handleCapture = useCallback(
    (index: number) => {
      const note = notes[index]
      if (!note) return
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      removeNote(note.id)
    },
    [notes, removeNote],
  )

  const pickUp = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  }, [])

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => {
      savedX.value = cameraX.value
      savedY.value = cameraY.value
    })
    .onUpdate((event) => {
      if (draggingIndex.value >= 0) return
      cameraX.value = savedX.value + event.translationX
      cameraY.value = savedY.value + event.translationY
    })

  const pinch = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value
    })
    .onUpdate((event) => {
      const next = clampScale(savedScale.value * event.scale)
      const ratio = next / scale.value
      // Zoom about the pinch focus so the pixel under the fingers stays put.
      cameraX.value = event.focalX - ratio * (event.focalX - cameraX.value)
      cameraY.value = event.focalY - ratio * (event.focalY - cameraY.value)
      scale.value = next
    })

  const tap = Gesture.Tap()
    .maxDuration(250)
    .onEnd((event) => {
      const camera = { x: cameraX.value, y: cameraY.value, scale: scale.value }
      const count = cullLinear(
        bounds.value,
        noteCount.value,
        visibleWorldRect(camera, { width, height }, 240),
        visible.value,
      )
      runOnJS(handleTap)(
        hitTestWithSlop(bounds.value, visible.value, count, event.x, event.y, camera),
      )
    })

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(280)
    .onEnd((event) => {
      const camera = { x: cameraX.value, y: cameraY.value, scale: scale.value }
      const count = cullLinear(
        bounds.value,
        noteCount.value,
        visibleWorldRect(camera, { width, height }, 240),
        visible.value,
      )
      const index = hitTestWithSlop(bounds.value, visible.value, count, event.x, event.y, camera)

      if (index >= 0) {
        runOnJS(handleDoubleTapNote)(index)
      } else {
        runOnJS(handleCreate)(screenToWorldX(event.x, camera), screenToWorldY(event.y, camera))
      }
    })

  /**
   * Long-press then drag: pick a note up, and if it is thrown hard enough
   * against gravity, feed it to the black hole.
   *
   * The whole thing runs on the UI thread. That is not a micro-optimisation —
   * the gesture *is* the feature, and a deletion animation that stutters
   * because the JS thread is busy persisting the previous edit would undercut
   * the entire premise.
   */
  const drag = Gesture.Pan()
    .activateAfterLongPress(280)
    .onStart((event) => {
      const camera = { x: cameraX.value, y: cameraY.value, scale: scale.value }
      const count = cullLinear(
        bounds.value,
        noteCount.value,
        visibleWorldRect(camera, { width, height }, 240),
        visible.value,
      )
      const index = hitTestWithSlop(bounds.value, visible.value, count, event.x, event.y, camera)
      if (index < 0) return

      draggingIndex.value = index
      dragStartX.value = event.x
      dragStartY.value = event.y
      dragX.value = event.x
      dragY.value = event.y
      dragOriginX.value = bounds.value[index * 4]!
      dragOriginY.value = bounds.value[index * 4 + 1]!
      stage.value = BlackHoleStage.Dragging
      runOnJS(pickUp)()
    })
    .onUpdate((event) => {
      if (draggingIndex.value < 0) return

      dragX.value = event.x
      dragY.value = event.y

      if (
        stage.value === BlackHoleStage.Dragging &&
        shouldArm(
          {
            x: event.x,
            y: event.y,
            translationY: event.translationY,
            velocityY: event.velocityY,
          },
          height,
          BLACK_HOLE_CONFIG,
        )
      ) {
        stage.value = BlackHoleStage.Armed
        // Springs in over a few frames rather than popping into existence.
        presence.value = withSpring(1, { damping: 16, stiffness: 140 })
      }

      // While armed, gravity owns the note's position; writing the finger
      // position into `bounds` would fight the pull.
      if (stage.value < BlackHoleStage.Armed) {
        const base = draggingIndex.value * 4
        bounds.value[base] = dragOriginX.value + (event.x - dragStartX.value) / scale.value
        bounds.value[base + 1] = dragOriginY.value + (event.y - dragStartY.value) / scale.value
      }
    })
    .onEnd((event) => {
      const index = draggingIndex.value
      if (index < 0) return

      const outcome = resolveRelease(
        {
          x: event.x,
          y: event.y,
          translationY: event.translationY,
          velocityY: event.velocityY,
        },
        width,
        height,
        stage.value,
      )

      if (outcome === BlackHoleStage.Captured) {
        runOnJS(handleCapture)(index)
      } else if (stage.value >= BlackHoleStage.Armed) {
        // Released outside the horizon: the note goes home, because while armed
        // its position stopped tracking the finger.
        const base = index * 4
        bounds.value[base] = dragOriginX.value
        bounds.value[base + 1] = dragOriginY.value
      } else {
        runOnJS(handleDrop)(
          index,
          bounds.value[index * 4]!,
          bounds.value[index * 4 + 1]!,
        )
      }

      draggingIndex.value = -1
      stage.value = BlackHoleStage.Idle
      presence.value = withTiming(0, { duration: 260 })
    })

  const composed = Gesture.Race(
    drag,
    Gesture.Simultaneous(pinch, pan),
    Gesture.Exclusive(doubleTap, tap),
  )

  return (
    <GestureDetector gesture={composed}>
      <Canvas style={styles.canvas}>
        <Picture picture={framePicture} />
      </Canvas>
    </GestureDetector>
  )
}

/**
 * Links and orbit rings, recorded once per data change.
 *
 * They sit behind everything and change only when notes are linked or a system
 * forms, so rebuilding them per frame would be pure waste.
 */
function recordStaticLayer(
  notes: Note[],
  systems: ReturnType<typeof useStore.getState>['systems'],
  links: ReturnType<typeof useStore.getState>['links'],
): SkPicture {
  const recorder = Skia.PictureRecorder()
  // A generous recording bound; Skia culls against the real clip at draw time.
  const canvas = recorder.beginRecording(Skia.XYWHRect(-1e6, -1e6, 2e6, 2e6))

  const byId = new Map(notes.map((n) => [n.id, n]))

  const linkPaint = Skia.Paint()
  linkPaint.setAntiAlias(true)
  linkPaint.setStyle(1)
  linkPaint.setStrokeWidth(1.5)
  linkPaint.setColor(Skia.Color(darkColors.link))

  for (const link of links) {
    if (link.deletedAt !== null) continue
    const from = byId.get(link.fromId)
    const to = byId.get(link.toId)
    if (!from || !to) continue

    canvas.drawLine(
      from.x + NOTE_WIDTH / 2,
      from.y + NOTE_HEIGHT / 2,
      to.x + NOTE_WIDTH / 2,
      to.y + NOTE_HEIGHT / 2,
      linkPaint,
    )
  }

  const orbitPaint = Skia.Paint()
  orbitPaint.setAntiAlias(true)
  orbitPaint.setStyle(1)
  orbitPaint.setStrokeWidth(1)
  orbitPaint.setColor(Skia.Color(darkColors.orbit))

  const starPaint = Skia.Paint()
  starPaint.setAntiAlias(true)
  starPaint.setColor(Skia.Color('#FFF3D6'))

  for (const system of systems) {
    if (system.deletedAt !== null) continue

    const radii = new Set<number>()
    for (const note of notes) {
      if (note.systemId === system.id && note.orbitRadius !== null) radii.add(note.orbitRadius)
    }
    for (const radius of radii) {
      canvas.drawCircle(system.centroidX, system.centroidY, radius, orbitPaint)
    }

    canvas.drawCircle(system.centroidX, system.centroidY, 16, starPaint)
  }

  return recorder.finishRecordingAsPicture()
}

interface DraggedParams {
  index: number
  bounds: Float32Array
  pictures: NotePictures[]
  camera: Camera
  viewport: { width: number; height: number }
  stage: BlackHoleStage
  presence: number
  dragX: number
  dragY: number
  dragStartY: number
  lod: Lod
}

function drawDragged(canvas: Parameters<Parameters<typeof createPicture>[0]>[0], params: DraggedParams): void {
  'worklet'
  const { index, bounds, pictures, camera, viewport, presence, dragX, dragY, lod } = params

  const visual = computeVisual(
    params.stage,
    { x: dragX, y: dragY, translationY: dragY - params.dragStartY, velocityY: 0 },
    viewport.width,
    viewport.height,
    presence,
  )

  const width = NOTE_WIDTH * camera.scale
  const height = NOTE_HEIGHT * camera.scale
  const picture = pictureForLod(pictures[index]!, lod === Lod.Star ? Lod.Card : lod)

  canvas.save()

  if (visual.pull > 0) {
    canvas.translate(visual.noteX, visual.noteY)
    canvas.rotate((visual.rotation * 180) / Math.PI, 0, 0)
    canvas.scale(visual.squeeze * camera.scale, visual.stretch * camera.scale)
    // Anchor the stretch to the edge facing the singularity, so the note trails
    // away from it. Scaling about the centre sends half the card straight
    // through the black hole and out the far side.
    const stretch = visual.stretch > 0.001 ? visual.stretch : 0.001
    canvas.translate(
      -NOTE_WIDTH / 2,
      NOTE_HEIGHT / 2 - NOTE_HEIGHT / (2 * stretch) - NOTE_HEIGHT / 2,
    )
  } else {
    const base = index * 4
    canvas.translate(
      bounds[base]! * camera.scale + camera.x,
      bounds[base + 1]! * camera.scale + camera.y,
    )
    canvas.scale(camera.scale * 1.05, camera.scale * 1.05)
    canvas.translate(-NOTE_WIDTH * 0.025, -NOTE_HEIGHT * 0.025)
  }

  canvas.drawPicture(picture)
  canvas.restore()

  // Keep the unused locals honest for the type checker.
  void width
  void height
}

function drawSingularity(
  canvas: Parameters<Parameters<typeof createPicture>[0]>[0],
  viewport: { width: number; height: number },
  presence: number,
  elapsed: number,
  drag: { x: number; y: number },
): void {
  'worklet'
  const cx = singularityX(viewport.width)
  const cy = singularityY(viewport.height, BLACK_HOLE_CONFIG)
  const horizon = BLACK_HOLE_CONFIG.horizonRadius

  // Gravitational lensing: light bending around the mass, brightest just
  // outside the horizon.
  const lens = Skia.Paint()
  lens.setAntiAlias(true)
  lens.setAlphaf(presence)
  lens.setShader(
    Skia.Shader.MakeRadialGradient(
      { x: cx, y: cy },
      horizon * 3.4,
      [Skia.Color('rgba(180,140,255,0.42)'), Skia.Color('rgba(122,63,255,0.14)'), Skia.Color('rgba(122,63,255,0)')],
      [0.28, 0.55, 1],
      0,
    ),
  )
  canvas.drawCircle(cx, cy, horizon * 3.4, lens)

  // Accretion disc, flattened and rotating.
  canvas.save()
  canvas.translate(cx, cy)
  canvas.rotate(((elapsed / 2600) * 360) % 360, 0, 0)
  canvas.scale(1, 0.32)

  const disc = Skia.Paint()
  disc.setAntiAlias(true)
  disc.setStyle(1)
  disc.setStrokeWidth(horizon * 0.5)
  disc.setAlphaf(presence)
  disc.setShader(
    Skia.Shader.MakeRadialGradient(
      { x: 0, y: 0 },
      horizon * 2.1,
      [Skia.Color('rgba(255,208,138,0.9)'), Skia.Color('rgba(255,138,90,0.5)'), Skia.Color('rgba(122,63,255,0)')],
      [0.45, 0.7, 1],
      0,
    ),
  )
  canvas.drawCircle(0, 0, horizon * 1.35, disc)
  canvas.restore()

  const dx = cx - drag.x
  const dy = cy - drag.y
  const willCapture = Math.sqrt(dx * dx + dy * dy) <= horizon

  const event = Skia.Paint()
  event.setAntiAlias(true)
  event.setColor(Skia.Color('#000000'))
  event.setAlphaf(presence)
  canvas.drawCircle(cx, cy, horizon * (willCapture ? 1.06 : 1), event)

  if (willCapture) {
    const rim = Skia.Paint()
    rim.setAntiAlias(true)
    rim.setStyle(1)
    rim.setStrokeWidth(2)
    rim.setColor(Skia.Color('rgba(255,255,255,0.5)'))
    rim.setAlphaf(presence)
    canvas.drawCircle(cx, cy, horizon * 1.06, rim)
  }
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    backgroundColor: darkColors.void,
  },
})
