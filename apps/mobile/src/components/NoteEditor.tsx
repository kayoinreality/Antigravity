import { useEffect, useState } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { NOTE_PALETTE, darkColors, radii, space, translate } from '@antigravity/core'
import { useStore } from '../state/store'

/**
 * Note editor, as a bottom sheet.
 *
 * Edits write through on every keystroke. There is no save button anywhere in
 * this app, so a draft held in component state would be a draft the user can
 * lose by backgrounding the app.
 */
interface Props {
  noteId: string | null
  onClose: () => void
}

export function NoteEditor({ noteId, onClose }: Props) {
  const notes = useStore((s) => s.notes)
  const editNote = useStore((s) => s.editNote)
  const removeNote = useStore((s) => s.removeNote)
  const locale = useStore((s) => s.locale)

  const note = notes.find((n) => n.id === noteId)
  const translateY = useSharedValue(700)
  const backdrop = useSharedValue(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (noteId) {
      setVisible(true)
      translateY.value = withSpring(0, { damping: 24, stiffness: 260, mass: 0.85 })
      backdrop.value = withTiming(1, { duration: 180 })
    } else {
      translateY.value = withSpring(700, { damping: 22, stiffness: 220 })
      backdrop.value = withTiming(0, { duration: 180 })
      // Keep the sheet mounted until it has finished sliding out.
      const timer = setTimeout(() => setVisible(false), 240)
      return () => clearTimeout(timer)
    }
  }, [noteId, translateY, backdrop])

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }))

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdrop.value * 0.72,
  }))

  if (!visible || !note) return null

  const words = note.content.trim() ? note.content.trim().split(/\s+/).length : 0

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
        </Pressable>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}
        >
          <Animated.View style={[styles.sheet, sheetStyle, { borderTopColor: note.color }]}>
            <View style={styles.grip} />

            <View style={styles.header}>
              <Pressable onPress={() => removeNote(note.id)} hitSlop={10} testID="editor-delete">
                <Text style={styles.delete}>{translate(locale, 'editor.delete')}</Text>
              </Pressable>
              <Pressable onPress={onClose} hitSlop={10} testID="editor-done">
                <Text style={[styles.done, { color: note.color }]}>
                  {translate(locale, 'editor.done')}
                </Text>
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.colors}>
                {NOTE_PALETTE.map((entry) => (
                  <Pressable
                    key={entry.key}
                    onPress={() => editNote(note.id, { color: entry.hex })}
                    accessibilityLabel={entry.key}
                    style={[
                      styles.color,
                      { backgroundColor: entry.hex },
                      note.color === entry.hex && styles.colorOn,
                    ]}
                  />
                ))}
              </View>

              <TextInput
                style={styles.title}
                value={note.title}
                onChangeText={(title) => editNote(note.id, { title })}
                placeholder={translate(locale, 'editor.title.placeholder')}
                placeholderTextColor={darkColors.textMuted}
                selectionColor={note.color}
                maxLength={120}
                autoFocus={!note.title && !note.content}
              />

              <View style={styles.divider} />

              <TextInput
                style={styles.body}
                value={note.content}
                onChangeText={(content) => editNote(note.id, { content })}
                placeholder={translate(locale, 'editor.body.placeholder')}
                placeholderTextColor={darkColors.textMuted}
                selectionColor={note.color}
                multiline
                textAlignVertical="top"
                scrollEnabled={false}
              />

              <View style={styles.stats}>
                <Text style={styles.statsText}>{translate(locale, 'editor.words', { count: words })}</Text>
                <Text style={styles.statsText}>·</Text>
                <Text style={styles.statsText}>
                  {translate(locale, 'editor.chars', { count: note.content.length })}
                </Text>
              </View>

              <View style={{ height: 48 }} />
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: darkColors.voidDeep },
  keyboard: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: darkColors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderTopWidth: 3,
    maxHeight: '88%',
    paddingHorizontal: space.lg - 4,
    paddingBottom: Platform.OS === 'ios' ? 34 : space.md,
  },
  grip: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: darkColors.borderStrong,
    alignSelf: 'center',
    marginTop: space.md - 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md - 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: darkColors.border,
  },
  delete: { color: darkColors.danger, fontSize: 15, fontWeight: '500' },
  done: { fontSize: 16, fontWeight: '700' },
  colors: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingVertical: space.md,
  },
  color: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: 'transparent' },
  colorOn: { borderColor: '#FFFFFF', transform: [{ scale: 1.16 }] },
  title: {
    color: darkColors.text,
    fontSize: 25,
    fontWeight: '700',
    letterSpacing: -0.5,
    paddingVertical: space.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: darkColors.border,
    marginBottom: space.md - 4,
  },
  body: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 16,
    lineHeight: 24,
    minHeight: 180,
  },
  stats: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.md,
    paddingTop: space.md - 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: darkColors.border,
  },
  statsText: { color: darkColors.textMuted, fontSize: 12, fontWeight: '500' },
})
