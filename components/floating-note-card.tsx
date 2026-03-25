import { memo, useEffect, useMemo, useRef } from 'react';
import {
    Animated,
    PanResponder,
    Pressable,
    StyleSheet,
    useWindowDimensions,
    View,
} from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Note } from '@/src/store/use-notes-store';

import { ThemedText } from './themed-text';

type FloatingNoteCardProps = {
  note: Note;
  bounds: {
    width: number;
    height: number;
  };
  onMove: (id: string, x: number, y: number) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
};

const CARD_WIDTH = 220;
const CARD_HEIGHT = 170;

const clamp = (value: number, min: number, max: number) => {
  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
};

function FloatingNoteCardComponent({ note, bounds, onMove, onEdit, onDelete }: FloatingNoteCardProps) {
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme() ?? 'light';
  const pan = useRef(new Animated.ValueXY({ x: note.x, y: note.y })).current;
  const currentX = useRef(note.x);
  const currentY = useRef(note.y);
  const isDragging = useRef(false);

  const cardWidth = useMemo(() => Math.min(CARD_WIDTH, width - 24), [width]);

  useEffect(() => {
    if (isDragging.current) {
      return;
    }

    currentX.current = note.x;
    currentY.current = note.y;
    pan.setValue({ x: note.x, y: note.y });
  }, [note.x, note.y, pan]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
        onPanResponderGrant: () => {
          isDragging.current = true;
          pan.stopAnimation((value: { x: number; y: number }) => {
            currentX.current = value.x;
            currentY.current = value.y;
            pan.setOffset({ x: value.x, y: value.y });
            pan.setValue({ x: 0, y: 0 });
          });
        },
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: () => {
          pan.flattenOffset();
          pan.stopAnimation((value: { x: number; y: number }) => {
            const maxX = Math.max(bounds.width - cardWidth, 0);
            const maxY = Math.max(bounds.height - CARD_HEIGHT, 0);

            const nextX = clamp(value.x, 0, maxX);
            const nextY = clamp(value.y, 0, maxY);

            currentX.current = nextX;
            currentY.current = nextY;

            pan.setValue({ x: nextX, y: nextY });
            onMove(note.id, nextX, nextY);
            isDragging.current = false;
          });
        },
        onPanResponderTerminate: () => {
          pan.flattenOffset();
          isDragging.current = false;
        },
      }),
    [bounds.height, bounds.width, cardWidth, note.id, onMove, pan]
  );

  const contentPreview = note.content.trim();

  return (
    <Animated.View
      style={[
        styles.card,
        {
          width: cardWidth,
          backgroundColor: Colors[colorScheme].background,
          borderColor: Colors[colorScheme].icon,
          transform: pan.getTranslateTransform(),
        },
      ]}
      {...panResponder.panHandlers}>
      <Pressable style={styles.cardContent} onPress={() => onEdit(note.id)}>
        <View style={styles.cardHeader}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>
            {note.title.trim() || 'Sem título'}
          </ThemedText>
          <Pressable hitSlop={8} onPress={() => onDelete(note.id)}>
            <ThemedText type="defaultSemiBold">×</ThemedText>
          </Pressable>
        </View>

        <ThemedText numberOfLines={5}>
          {contentPreview || 'Toque para editar e escrever a sua nota.'}
        </ThemedText>
      </Pressable>
    </Animated.View>
  );
}

export const FloatingNoteCard = memo(FloatingNoteCardComponent);

const styles = StyleSheet.create({
  card: {
    height: CARD_HEIGHT,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    position: 'absolute',
    overflow: 'hidden',
  },
  cardContent: {
    flex: 1,
    padding: 14,
    justifyContent: 'space-between',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
});
