import { useCallback } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import type { SharedValue } from 'react-native-reanimated'
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated'
import { useNotesStore } from '../../stores/notesStore'
import type { Note } from '../../types/note'
import { NOTE_MIN_HEIGHT, NOTE_WIDTH } from '../../types/note'

interface Props {
  note: Note
  canvasScale: SharedValue<number>
  onOpenEditor: (id: string) => void
}

export default function FloatingNote({ note, canvasScale, onOpenEditor }: Props) {
  const {
    selectedNoteId,
    connectMode,
    connectSourceId,
    selectNote,
    moveNote,
    toggleConnection,
    enterConnectMode,
    exitConnectMode,
  } = useNotesStore()

  const isSelected = selectedNoteId === note.id
  const isConnectSource = connectSourceId === note.id

  const offsetX = useSharedValue(0)
  const offsetY = useSharedValue(0)
  const isDragging = useSharedValue(false)

  const handleSelect = useCallback(() => {
    if (connectMode) {
      toggleConnection(connectSourceId!, note.id)
    } else {
      selectNote(note.id)
    }
  }, [connectMode, connectSourceId, note.id, selectNote, toggleConnection])

  const handleDoubleTap = useCallback(() => {
    if (!connectMode) {
      selectNote(note.id)
      onOpenEditor(note.id)
    }
  }, [connectMode, note.id, onOpenEditor, selectNote])

  const handleLongPress = useCallback(() => {
    if (!connectMode) {
      enterConnectMode(note.id)
    } else {
      exitConnectMode()
    }
  }, [connectMode, note.id, enterConnectMode, exitConnectMode])

  const handleMoveEnd = useCallback(
    (dx: number, dy: number, s: number) => {
      const newX = note.x + dx / s
      const newY = note.y + dy / s
      moveNote(note.id, newX, newY)
    },
    [note.id, note.x, note.y, moveNote]
  )

  const tapGesture = Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(250)
    .onEnd(() => runOnJS(handleSelect)())

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => runOnJS(handleDoubleTap)())

  const longPressGesture = Gesture.LongPress()
    .minDuration(500)
    .onStart(() => runOnJS(handleLongPress)())

  const panGesture = Gesture.Pan()
    .minDistance(6)
    .onStart(() => {
      isDragging.value = true
    })
    .onUpdate((e) => {
      offsetX.value = e.translationX
      offsetY.value = e.translationY
    })
    .onEnd((e) => {
      runOnJS(handleMoveEnd)(e.translationX, e.translationY, canvasScale.value)
      offsetX.value = withTiming(0, { duration: 0 })
      offsetY.value = withTiming(0, { duration: 0 })
      isDragging.value = false
    })

  const composed = Gesture.Exclusive(
    panGesture,
    Gesture.Exclusive(doubleTapGesture, Gesture.Simultaneous(tapGesture, longPressGesture))
  )

  const animatedStyle = useAnimatedStyle(() => {
    const s = canvasScale.value
    return {
      left: note.x + offsetX.value / s,
      top: note.y + offsetY.value / s,
      opacity: withTiming(isDragging.value ? 0.85 : 1, { duration: 80 }),
      transform: [
        { scale: withSpring(isDragging.value ? 1.06 : 1, { damping: 18, stiffness: 300 }) },
      ],
      zIndex: isDragging.value ? 999 : isSelected ? 100 : 1,
    }
  })

  const titleText = note.title.trim() || note.content.trim().split('\n')[0] || 'New Note'
  const previewLines = note.content.trim().split('\n').slice(0, 4).join('\n')

  const isConnected =
    connectMode && connectSourceId && note.id !== connectSourceId
      ? useNotesStore
          .getState()
          .notes.find((n) => n.id === connectSourceId)
          ?.connections.includes(note.id)
      : false

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        style={[
          styles.note,
          animatedStyle,
          {
            backgroundColor: note.color,
            borderWidth: isSelected ? 2.5 : isConnectSource ? 3 : isConnected ? 2 : 0,
            borderColor: isConnectSource
              ? '#FFFFFF'
              : isConnected
              ? '#FFFFFF88'
              : isSelected
              ? '#00000040'
              : 'transparent',
            shadowColor: '#000',
            shadowOpacity: isSelected ? 0.35 : 0.2,
            shadowRadius: isSelected ? 16 : 8,
            shadowOffset: { width: 0, height: isSelected ? 6 : 3 },
            elevation: isSelected ? 12 : 4,
          },
        ]}
      >
        {connectMode && !isConnectSource && (
          <View style={styles.connectOverlay} />
        )}
        {isConnectSource && (
          <View style={styles.connectBadge}>
            <Text style={styles.connectBadgeText}>⚡</Text>
          </View>
        )}
        <Text style={styles.title} numberOfLines={1}>
          {titleText}
        </Text>
        {previewLines !== titleText && previewLines.length > 0 && (
          <Text style={styles.preview} numberOfLines={3}>
            {previewLines}
          </Text>
        )}
        <Text style={styles.date}>
          {new Date(note.updatedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </Text>
      </Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  note: {
    position: 'absolute',
    width: NOTE_WIDTH,
    minHeight: NOTE_MIN_HEIGHT,
    borderRadius: 16,
    padding: 14,
    paddingBottom: 10,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 4 },
    }),
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a2e',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  preview: {
    fontSize: 11.5,
    lineHeight: 16,
    color: '#1a1a2eCC',
    marginBottom: 8,
  },
  date: {
    fontSize: 10,
    color: '#1a1a2e88',
    fontWeight: '500',
    marginTop: 'auto',
  },
  connectOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 14,
  },
  connectBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
    zIndex: 10,
  },
  connectBadgeText: {
    fontSize: 12,
  },
})