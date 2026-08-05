import { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { darkColors, space, translate } from '@antigravity/core'
import { SkiaCanvas } from '../src/canvas/SkiaCanvas'
import { SearchBar } from '../src/components/SearchBar'
import { NoteEditor } from '../src/components/NoteEditor'
import { EmptyState, SuggestionPill, SyncBadge, UndoToast } from '../src/components/Overlays'
import { useStore } from '../src/state/store'

export default function CanvasScreen() {
  const [editorNoteId, setEditorNoteId] = useState<string | null>(null)
  const notes = useStore((s) => s.notes)
  const locale = useStore((s) => s.locale)

  const openEditor = useCallback((id: string) => setEditorNoteId(id), [])
  const closeEditor = useCallback(() => setEditorNoteId(null), [])

  return (
    <View style={styles.root}>
      <SkiaCanvas onOpenEditor={openEditor} />

      <EmptyState />

      {/* box-none: the chrome floats over the canvas, and only its own controls
          take touches — everything else falls through to the gesture handler. */}
      <SafeAreaView style={styles.overlay} pointerEvents="box-none" edges={['top']}>
        <View style={styles.header} pointerEvents="box-none">
          <View style={styles.brandRow} pointerEvents="box-none">
            <View pointerEvents="none">
              <Text style={styles.brand}>antigravity</Text>
              <Text style={styles.count}>
                {notes.length === 1
                  ? translate(locale, 'canvas.notes.one')
                  : translate(locale, 'canvas.notes.many', { count: notes.length })}
              </Text>
            </View>
            <SyncBadge />
          </View>
          <SearchBar />
        </View>
      </SafeAreaView>

      <SuggestionPill />
      <UndoToast />

      <NoteEditor noteId={editorNoteId} onClose={closeEditor} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: darkColors.void },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  header: { paddingHorizontal: space.md + 2, paddingTop: space.sm, gap: space.sm + 2 },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  brand: {
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.7,
    color: darkColors.text,
  },
  count: { fontSize: 12, color: darkColors.textMuted, fontWeight: '500', marginTop: 1 },
})
