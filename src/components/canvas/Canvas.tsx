import { useCallback } from 'react'
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
    clamp,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
} from 'react-native-reanimated'
import { CanvasContext } from '../../contexts/CanvasContext'
import { useNotesStore } from '../../stores/notesStore'
import ConnectionLine from './ConnectionLine'
import FloatingNote from './FloatingNote'

const MIN_SCALE = 0.2
const MAX_SCALE = 3.5
const CANVAS_SIZE = 8000
const INITIAL_OFFSET = CANVAS_SIZE / 2

interface CanvasProps {
  onOpenEditor: (id: string) => void
}

export default function Canvas({ onOpenEditor }: CanvasProps) {
  const { width: W, height: H } = useWindowDimensions()
  const { notes, addNote, selectNote, connectMode, exitConnectMode } = useNotesStore()

  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)
  const scale = useSharedValue(1)

  const savedTX = useSharedValue(0)
  const savedTY = useSharedValue(0)
  const savedScale = useSharedValue(1)

  const focalX = useSharedValue(W / 2)
  const focalY = useSharedValue(H / 2)

  const handleCreateNote = useCallback(
    (screenX: number, screenY: number) => {
      const worldX = (screenX - (W / 2 + translateX.value)) / scale.value + INITIAL_OFFSET
      const worldY = (screenY - (H / 2 + translateY.value)) / scale.value + INITIAL_OFFSET
      addNote(worldX - 90, worldY - 55)
    },
    [W, H, translateX, translateY, scale, addNote]
  )

  const handleCanvasTap = useCallback(() => {
    if (connectMode) {
      exitConnectMode()
    } else {
      selectNote(null)
    }
  }, [connectMode, exitConnectMode, selectNote])

  const panGesture = Gesture.Pan()
    .onBegin(() => {
      savedTX.value = translateX.value
      savedTY.value = translateY.value
    })
    .onUpdate((e) => {
      translateX.value = savedTX.value + e.translationX
      translateY.value = savedTY.value + e.translationY
    })
    .minPointers(2)
    .maxPointers(2)

  const pinchGesture = Gesture.Pinch()
    .onBegin((e) => {
      savedScale.value = scale.value
      focalX.value = e.focalX
      focalY.value = e.focalY
    })
    .onUpdate((e) => {
      const newScale = clamp(savedScale.value * e.scale, MIN_SCALE, MAX_SCALE)
      const scaleDiff = newScale / scale.value

      translateX.value = focalX.value - scaleDiff * (focalX.value - translateX.value)
      translateY.value = focalY.value - scaleDiff * (focalY.value - translateY.value)
      scale.value = newScale
    })

  const bgPanGesture = Gesture.Pan()
    .onBegin(() => {
      savedTX.value = translateX.value
      savedTY.value = translateY.value
    })
    .onUpdate((e) => {
      translateX.value = savedTX.value + e.translationX
      translateY.value = savedTY.value + e.translationY
    })
    .maxPointers(1)
    .requireExternalGestureToFail()

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd((e) => {
      runOnJS(handleCreateNote)(e.x, e.y)
    })

  const singleTapGesture = Gesture.Tap()
    .numberOfTaps(1)
    .maxDelay(150)
    .onEnd(() => {
      runOnJS(handleCanvasTap)()
    })

  const backgroundGesture = Gesture.Exclusive(
    doubleTapGesture,
    singleTapGesture,
    bgPanGesture
  )

  const twoFingerGesture = Gesture.Simultaneous(panGesture, pinchGesture)

  const surfaceAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }))

  const isEmpty = notes.length === 0

  return (
    <CanvasContext.Provider value={{ translateX, translateY, scale, screenW: W, screenH: H }}>
      <View style={styles.container}>
        <GestureDetector gesture={backgroundGesture}>
          <View style={StyleSheet.absoluteFillObject}>
            <DotGrid />
          </View>
        </GestureDetector>

        <GestureDetector gesture={twoFingerGesture}>
          <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
            <Animated.View style={[styles.surface, surfaceAnimatedStyle]}>
              {notes.flatMap((note) =>
                note.connections
                  .map((toId) => {
                    const toNote = notes.find((n) => n.id === toId)
                    if (!toNote) return null
                    return (
                      <ConnectionLine
                        key={`${note.id}→${toId}`}
                        fromNote={note}
                        toNote={toNote}
                      />
                    )
                  })
                  .filter(Boolean)
              )}

              {notes.map((note) => (
                <FloatingNote
                  key={note.id}
                  note={note}
                  canvasScale={scale}
                  onOpenEditor={onOpenEditor}
                />
              ))}
            </Animated.View>
          </View>
        </GestureDetector>

        {isEmpty && (
          <View style={styles.emptyHint} pointerEvents="none">
            <Text style={styles.emptyIcon}>✦</Text>
            <Text style={styles.emptyTitle}>Your canvas awaits</Text>
            <Text style={styles.emptySubtitle}>Double-tap anywhere to create a note</Text>
          </View>
        )}

        {connectMode && (
          <View style={styles.connectBanner} pointerEvents="none">
            <Text style={styles.connectBannerText}>
              ⚡ Tap a note to connect — tap canvas to cancel
            </Text>
          </View>
        )}
      </View>
    </CanvasContext.Provider>
  )
}

function DotGrid() {
  return (
    <View style={[StyleSheet.absoluteFillObject, styles.dotGrid]} pointerEvents="none" />
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d1a',
    overflow: 'hidden',
  },
  dotGrid: {
    backgroundColor: '#0d0d1a',
  },
  surface: {
    position: 'absolute',
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    left: -(CANVAS_SIZE / 2),
    top: -(CANVAS_SIZE / 2),
  },
  emptyHint: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    pointerEvents: 'none',
  },
  emptyIcon: {
    fontSize: 36,
    color: 'rgba(255,255,255,0.15)',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.18)',
    letterSpacing: -0.5,
  },
  emptySubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.1)',
    fontWeight: '400',
  },
  connectBanner: {
    position: 'absolute',
    bottom: 120,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(108, 92, 231, 0.9)',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    shadowColor: '#6C5CE7',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  connectBannerText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
    letterSpacing: -0.2,
  },
})