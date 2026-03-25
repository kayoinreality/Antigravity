import Canvas from '@/src/components/canvas/Canvas'
import NoteEditorModal from '@/src/components/modals/NoteEditorModal'
import FAB from '@/src/components/ui/FAB'
import { useNotesStore } from '@/src/stores/notesStore'
import { useCallback, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function CanvasScreen() {
  const [editorNoteId, setEditorNoteId] = useState<string | null>(null)
  const { notes, addNote, connectMode, exitConnectMode } = useNotesStore()

  const handleOpenEditor = useCallback((id: string) => {
    setEditorNoteId(id)
  }, [])

  const handleCloseEditor = useCallback(() => {
    setEditorNoteId(null)
  }, [])

  const handleNewNote = useCallback(() => {
    const id = addNote(3900, 3890)
    setEditorNoteId(id)
  }, [addNote])

  return (
    <View style={styles.root}>
      <Canvas onOpenEditor={handleOpenEditor} />

      <SafeAreaView style={styles.headerOverlay} pointerEvents="box-none">
        <View style={styles.header} pointerEvents="box-none">
          <View pointerEvents="none">
            <Text style={styles.appName}>antigravity</Text>
            <Text style={styles.noteCount}>
              {notes.length} {notes.length === 1 ? 'note' : 'notes'}
            </Text>
          </View>
          {connectMode && (
            <TouchableOpacity
              style={styles.cancelConnectBtn}
              onPress={exitConnectMode}
            >
              <Text style={styles.cancelConnectText}>✕ Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>

      {!connectMode && (
        <FAB
          onPress={handleNewNote}
          icon="+"
          color="#6C5CE7"
          bottom={100}
          right={24}
        />
      )}

      <NoteEditorModal noteId={editorNoteId} onClose={handleCloseEditor} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0d0d1a',
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    pointerEvents: 'box-none',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 12,
  },
  appName: {
    fontSize: 20,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: -0.8,
  },
  noteCount: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    fontWeight: '500',
    marginTop: 1,
  },
  cancelConnectBtn: {
    backgroundColor: 'rgba(255,107,107,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.4)',
    marginTop: 4,
  },
  cancelConnectText: {
    color: '#FF6B6B',
    fontWeight: '600',
    fontSize: 13,
  },
})