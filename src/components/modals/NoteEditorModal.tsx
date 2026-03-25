import { useCallback, useEffect, useRef, useState } from 'react'
import {
    Alert,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated'
import { useNotesStore } from '../../stores/notesStore'
import { NOTE_COLORS } from '../../types/note'

interface Props {
  noteId: string | null
  onClose: () => void
}

export default function NoteEditorModal({ noteId, onClose }: Props) {
  const { notes, updateNote, deleteNote, stopEditing } = useNotesStore()
  const note = notes.find((n) => n.id === noteId)

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [selectedColor, setSelectedColor] = useState(NOTE_COLORS[0])

  const titleRef = useRef<TextInput>(null)
  const translateY = useSharedValue(800)
  const opacity = useSharedValue(0)

  const isVisible = !!noteId

  useEffect(() => {
    if (note) {
      setTitle(note.title)
      setContent(note.content)
      setSelectedColor(note.color as any)
    }
  }, [noteId])

  useEffect(() => {
    if (isVisible) {
      translateY.value = withSpring(0, { damping: 22, stiffness: 280, mass: 0.9 })
      opacity.value = withTiming(1, { duration: 200 })
    } else {
      translateY.value = withSpring(800, { damping: 18, stiffness: 200 })
      opacity.value = withTiming(0, { duration: 200 })
    }
  }, [isVisible, opacity, translateY])

  const handleClose = useCallback(() => {
    if (note && noteId) {
      updateNote(noteId, { title: title.trim(), content: content.trim(), color: selectedColor })
    }
    stopEditing()
    onClose()
  }, [note, noteId, title, content, selectedColor, updateNote, stopEditing, onClose])

  const handleDelete = useCallback(() => {
    Alert.alert('Delete Note', 'This note will be permanently deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (noteId) deleteNote(noteId)
          stopEditing()
          onClose()
        },
      },
    ])
  }, [noteId, deleteNote, stopEditing, onClose])

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }))

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: opacity.value * 0.6,
  }))

  const dismissGesture = Gesture.Pan()
    .onEnd((e) => {
      if (e.translationY > 80 || e.velocityY > 800) {
        runOnJS(handleClose)()
      }
    })

  if (!note) return null

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const charCount = content.length

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={styles.root}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={handleClose} activeOpacity={1}>
          <Animated.View style={[StyleSheet.absoluteFillObject, styles.backdrop, backdropStyle]} />
        </TouchableOpacity>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kavContainer}
          keyboardVerticalOffset={0}
        >
          <GestureDetector gesture={dismissGesture}>
            <Animated.View style={[styles.sheet, sheetStyle, { borderTopColor: note.color }]}> 
              <View style={styles.handle} />

              <View style={styles.header}>
                <TouchableOpacity onPress={handleDelete} style={styles.deleteBtn}>
                  <Text style={styles.deleteBtnText}>Delete</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Edit Note</Text>
                <TouchableOpacity onPress={handleClose} style={styles.doneBtn}>
                  <Text style={[styles.doneBtnText, { color: note.color }]}>Done</Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.scrollArea}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.colorRow}>
                  {NOTE_COLORS.map((color) => (
                    <TouchableOpacity
                      key={color}
                      style={[
                        styles.colorDot,
                        { backgroundColor: color },
                        selectedColor === color && styles.colorDotSelected,
                      ]}
                      onPress={() => {
                        setSelectedColor(color)
                        if (noteId) updateNote(noteId, { color })
                      }}
                    />
                  ))}
                </View>

                <TextInput
                  ref={titleRef}
                  style={styles.titleInput}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Title"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  selectionColor={note.color}
                  returnKeyType="next"
                  maxLength={80}
                  autoFocus={!note.title && !note.content}
                />

                <View style={styles.divider} />

                <TextInput
                  style={styles.contentInput}
                  value={content}
                  onChangeText={setContent}
                  placeholder="Start writing..."
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  multiline
                  textAlignVertical="top"
                  selectionColor={note.color}
                  scrollEnabled={false}
                />

                <View style={styles.statsRow}>
                  <Text style={styles.statsText}>{wordCount} words</Text>
                  <Text style={styles.statsText}>·</Text>
                  <Text style={styles.statsText}>{charCount} chars</Text>
                </View>

                <View style={{ height: 40 }} />
              </ScrollView>
            </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    backgroundColor: '#0d0d1a',
  },
  kavContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#13131f',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 3,
    maxHeight: '90%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  deleteBtn: {
    padding: 4,
  },
  deleteBtnText: {
    color: '#FF6B6B',
    fontSize: 15,
    fontWeight: '500',
  },
  doneBtn: {
    padding: 4,
  },
  doneBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  scrollArea: {
    paddingHorizontal: 20,
  },
  colorRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 16,
    flexWrap: 'wrap',
  },
  colorDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  colorDotSelected: {
    transform: [{ scale: 1.3 }],
    shadowColor: '#fff',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  titleInput: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    paddingVertical: 8,
    marginBottom: 4,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginBottom: 12,
  },
  contentInput: {
    fontSize: 16,
    lineHeight: 24,
    color: 'rgba(255,255,255,0.85)',
    minHeight: 160,
    paddingVertical: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  statsText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.25)',
    fontWeight: '500',
  },
})