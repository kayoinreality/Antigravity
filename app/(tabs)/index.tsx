import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingNoteCard } from '@/components/floating-note-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useNotesStore } from '@/src/store/use-notes-store';

const MIN_BOARD_WIDTH = 320;
const MIN_BOARD_HEIGHT = 420;

export default function NotesBoardScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const notes = useNotesStore((state) => state.notes);
  const isHydrated = useNotesStore((state) => state.isHydrated);
  const hydrate = useNotesStore((state) => state.hydrate);
  const deleteNote = useNotesStore((state) => state.deleteNote);
  const moveNote = useNotesStore((state) => state.moveNote);
  const [boardSize, setBoardSize] = useState({
    width: MIN_BOARD_WIDTH,
    height: MIN_BOARD_HEIGHT,
  });

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const handleBoardLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBoardSize({
      width: Math.max(width, MIN_BOARD_WIDTH),
      height: Math.max(height, MIN_BOARD_HEIGHT),
    });
  };

  const handleCreateNote = async () => {
    await Haptics.selectionAsync();
    router.push('/modal');
  };

  const handleEditNote = (id: string) => {
    router.push({
      pathname: '/modal',
      params: { id },
    });
  };

  const handleDeleteNote = async (id: string) => {
    deleteNote(id);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const boardBounds = useMemo(
    () => ({ width: boardSize.width, height: boardSize.height }),
    [boardSize.height, boardSize.width]
  );

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View>
          <ThemedText type="title">Antigravity Notes</ThemedText>
          <ThemedText>Notas flutuantes locais, rápidas e offline.</ThemedText>
        </View>

        <Pressable
          onPress={handleCreateNote}
          style={[styles.addButton, { borderColor: Colors[colorScheme].tint }]}
          hitSlop={8}>
          <ThemedText type="defaultSemiBold" style={{ color: Colors[colorScheme].tint }}>
            + Nova
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.board} onLayout={handleBoardLayout}>
        {!isHydrated && <ActivityIndicator color={Colors[colorScheme].tint} size="small" />}

        {isHydrated && notes.length === 0 && (
          <View style={styles.emptyState}>
            <ThemedText type="subtitle">Seu mural está vazio</ThemedText>
            <ThemedText>Toque em + Nova para criar a primeira nota flutuante.</ThemedText>
          </View>
        )}

        {isHydrated &&
          notes.map((note) => (
            <FloatingNoteCard
              key={note.id}
              note={note}
              bounds={boardBounds}
              onMove={moveNote}
              onEdit={handleEditNote}
              onDelete={handleDeleteNote}
            />
          ))}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 12,
  },
  addButton: {
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  board: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    flex: 1,
    gap: 8,
  },
});