import NoteEditorModal from '@/src/components/modals/NoteEditorModal'
import { useNotesStore } from '@/src/stores/notesStore'
import type { Note } from '@/src/types/note'
import { useCallback, useMemo, useState } from 'react'
import {
    Alert,
    FlatList,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native'
import Animated, {
    FadeInDown,
    FadeOutUp,
    Layout,
} from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'

type SortKey = 'updated' | 'created' | 'title'

export default function NotesListScreen() {
  const { notes, deleteNote, clearAll } = useNotesStore()
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('updated')
  const [editorId, setEditorId] = useState<string | null>(null)

  const filteredNotes = useMemo(() => {
    const q = query.toLowerCase().trim()
    let result = q
      ? notes.filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            n.content.toLowerCase().includes(q)
        )
      : [...notes]

    result.sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title)
      if (sortBy === 'created') return b.createdAt - a.createdAt
      return b.updatedAt - a.updatedAt
    })

    return result
  }, [notes, query, sortBy])

  const handleClearAll = useCallback(() => {
    Alert.alert(
      'Clear All Notes',
      `This will permanently delete all ${notes.length} notes.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear All', style: 'destructive', onPress: clearAll },
      ]
    )
  }, [notes.length, clearAll])

  const renderNote = useCallback(
    ({ item, index }: { item: Note; index: number }) => (
      <Animated.View
        entering={FadeInDown.delay(index * 40).springify()}
        exiting={FadeOutUp.springify()}
        layout={Layout.springify()}
      >
        <TouchableOpacity
          style={[styles.noteCard, { borderLeftColor: item.color }]}
          onPress={() => setEditorId(item.id)}
          activeOpacity={0.75}
        >
          <View style={[styles.colorBar, { backgroundColor: item.color + '33' }]} />
          <View style={styles.noteContent}>
            <Text style={styles.noteTitle} numberOfLines={1}>
              {item.title.trim() || item.content.trim().split('\n')[0] || 'Untitled'}
            </Text>
            {item.content.trim().length > 0 && (
              <Text style={styles.notePreview} numberOfLines={2}>
                {item.content.trim()}
              </Text>
            )}
            <View style={styles.noteMeta}>
              <Text style={styles.noteDate}>
                {formatDate(item.updatedAt)}
              </Text>
              {item.connections.length > 0 && (
                <Text style={styles.connections}>
                  ⚡ {item.connections.length}
                </Text>
              )}
            </View>
          </View>
          <View style={[styles.colorDot, { backgroundColor: item.color }]} />
        </TouchableOpacity>
      </Animated.View>
    ),
    []
  )

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.heading}>Notes</Text>
          <Text style={styles.subheading}>{notes.length} total</Text>
        </View>
        {notes.length > 0 && (
          <TouchableOpacity onPress={handleClearAll} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>Clear all</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.searchRow}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search notes..."
          placeholderTextColor="rgba(255,255,255,0.25)"
          selectionColor="#A29BFE"
          clearButtonMode="while-editing"
        />
      </View>

      <View style={styles.sortRow}>
        {(['updated', 'created', 'title'] as SortKey[]).map((key) => (
          <TouchableOpacity
            key={key}
            style={[styles.sortTab, sortBy === key && styles.sortTabActive]}
            onPress={() => setSortBy(key)}
          >
            <Text
              style={[
                styles.sortTabText,
                sortBy === key && styles.sortTabTextActive,
              ]}
            >
              {key.charAt(0).toUpperCase() + key.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {filteredNotes.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>✦</Text>
          <Text style={styles.emptyText}>
            {query ? 'No notes match your search' : 'No notes yet.\nDouble-tap the canvas to create one.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredNotes}
          keyExtractor={(item) => item.id}
          renderItem={renderNote}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}

      <NoteEditorModal noteId={editorId} onClose={() => setEditorId(null)} />
    </SafeAreaView>
  )
}

function formatDate(ts: number): string {
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0d0d1a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
  },
  heading: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -1,
  },
  subheading: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.3)',
    fontWeight: '500',
    marginTop: 2,
  },
  clearBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: 'rgba(255,107,107,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.25)',
  },
  clearBtnText: {
    color: '#FF6B6B',
    fontSize: 13,
    fontWeight: '600',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    paddingHorizontal: 14,
    marginBottom: 12,
    height: 46,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  searchIcon: {
    fontSize: 20,
    color: 'rgba(255,255,255,0.3)',
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#fff',
    height: '100%',
  },
  sortRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 16,
  },
  sortTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  sortTabActive: {
    backgroundColor: 'rgba(162,155,254,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(162,155,254,0.4)',
  },
  sortTabText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '500',
  },
  sortTabTextActive: {
    color: '#A29BFE',
    fontWeight: '700',
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 80,
  },
  separator: {
    height: 8,
  },
  noteCard: {
    backgroundColor: '#13131f',
    borderRadius: 18,
    overflow: 'hidden',
    borderLeftWidth: 4,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  colorBar: {
    width: 0,
  },
  noteContent: {
    flex: 1,
    padding: 16,
  },
  noteTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  notePreview: {
    fontSize: 13.5,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.45)',
    marginBottom: 10,
  },
  noteMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  noteDate: {
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.25)',
    fontWeight: '500',
  },
  connections: {
    fontSize: 11.5,
    color: 'rgba(162,155,254,0.6)',
    fontWeight: '600',
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    alignSelf: 'center',
    marginRight: 16,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
    gap: 12,
  },
  emptyIcon: {
    fontSize: 40,
    color: 'rgba(255,255,255,0.1)',
  },
  emptyText: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.2)',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 40,
  },
})
