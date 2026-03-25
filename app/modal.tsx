import * as Haptics from 'expo-haptics';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useNotesStore } from '@/src/store/use-notes-store';

export default function ModalScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const noteId = Array.isArray(id) ? id[0] : id;
  const colorScheme = useColorScheme() ?? 'light';

  const createNote = useNotesStore((state) => state.createNote);
  const updateNote = useNotesStore((state) => state.updateNote);
  const deleteNote = useNotesStore((state) => state.deleteNote);
  const note = useNotesStore((state) => state.notes.find((item) => item.id === noteId));

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const isEditing = Boolean(note);

  useEffect(() => {
    if (!note) {
      return;
    }

    setTitle(note.title);
    setContent(note.content);
  }, [note]);

  const canSave = useMemo(() => {
    return title.trim().length > 0 || content.trim().length > 0;
  }, [content, title]);

  const handleSave = async () => {
    const nextTitle = title.trim();
    const nextContent = content.trim();

    if (!nextTitle && !nextContent) {
      return;
    }

    if (isEditing && noteId) {
      updateNote({
        id: noteId,
        title: nextTitle,
        content: nextContent,
      });
    } else {
      createNote({
        title: nextTitle,
        content: nextContent,
      });
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  const handleDelete = async () => {
    if (!noteId) {
      return;
    }

    deleteNote(noteId);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    router.back();
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: isEditing ? 'Editar nota' : 'Nova nota' }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoid}>
        <View style={[styles.content, { paddingBottom: insets.bottom + 10 }]}>
          <ThemedText type="subtitle">Título</ThemedText>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Ex: ideias para o próximo sprint"
            placeholderTextColor={Colors[colorScheme].icon}
            style={[
              styles.input,
              {
                borderColor: Colors[colorScheme].icon,
                color: Colors[colorScheme].text,
              },
            ]}
            returnKeyType="next"
            maxLength={80}
          />

          <ThemedText type="subtitle">Conteúdo</ThemedText>
          <TextInput
            value={content}
            onChangeText={setContent}
            placeholder="Escreva a nota..."
            placeholderTextColor={Colors[colorScheme].icon}
            style={[
              styles.input,
              styles.multilineInput,
              {
                borderColor: Colors[colorScheme].icon,
                color: Colors[colorScheme].text,
              },
            ]}
            multiline
            textAlignVertical="top"
          />

          <View style={styles.actionsRow}>
            <Pressable
              onPress={() => router.back()}
              style={[styles.actionButton, { borderColor: Colors[colorScheme].icon }]}>
              <ThemedText>Cancelar</ThemedText>
            </Pressable>

            <Pressable
              onPress={handleSave}
              disabled={!canSave}
              style={[
                styles.actionButton,
                {
                  borderColor: Colors[colorScheme].tint,
                  opacity: canSave ? 1 : 0.5,
                },
              ]}>
              <ThemedText type="defaultSemiBold" style={{ color: Colors[colorScheme].tint }}>
                Salvar
              </ThemedText>
            </Pressable>
          </View>

          {isEditing && (
            <Pressable
              onPress={handleDelete}
              style={[styles.deleteButton, { borderColor: Colors[colorScheme].icon }]}>
              <ThemedText type="defaultSemiBold">Excluir nota</ThemedText>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardAvoid: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 10,
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  multilineInput: {
    minHeight: 180,
    paddingTop: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  actionButton: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButton: {
    marginTop: 8,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
