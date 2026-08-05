import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated'
import { darkColors, radii, space, translate } from '@antigravity/core'
import { useStore } from '../state/store'

export function SuggestionPill() {
  const suggestion = useStore((s) => s.suggestion)
  const accept = useStore((s) => s.acceptSuggestion)
  const dismiss = useStore((s) => s.dismissSuggestion)
  const locale = useStore((s) => s.locale)

  if (!suggestion) return null

  return (
    <Animated.View
      entering={FadeInDown.duration(320)}
      exiting={FadeOutDown.duration(180)}
      style={styles.pill}
      testID="suggestion"
    >
      <Text style={styles.star}>☉</Text>
      <Text style={styles.pillText} numberOfLines={2}>
        {translate(locale, 'system.suggest', {
          count: suggestion.noteIds.length,
          label: suggestion.label,
        })}
      </Text>
      <Pressable style={styles.accept} onPress={accept} testID="suggestion-accept">
        <Text style={styles.acceptText}>{translate(locale, 'system.accept')}</Text>
      </Pressable>
      <Pressable style={styles.dismiss} onPress={dismiss} hitSlop={8}>
        <Text style={styles.dismissText}>{translate(locale, 'system.dismiss')}</Text>
      </Pressable>
    </Animated.View>
  )
}

export function UndoToast() {
  const undo = useStore((s) => s.undo)
  const undoRemove = useStore((s) => s.undoRemove)
  const locale = useStore((s) => s.locale)
  const [, tick] = useState(0)

  // The toast has a deadline, so it needs a tick to disappear on its own even
  // when nothing else in the app changes.
  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => tick((n) => n + 1), Math.max(0, undo.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [undo])

  if (!undo || undo.expiresAt < Date.now()) return null

  return (
    <Animated.View
      entering={FadeInDown.duration(220)}
      exiting={FadeOutDown.duration(160)}
      style={styles.toast}
      testID="undo-toast"
    >
      <Text style={styles.toastText}>{translate(locale, 'blackhole.deleted')}</Text>
      <Pressable onPress={undoRemove} hitSlop={10}>
        <Text style={styles.toastAction}>{translate(locale, 'blackhole.undo')}</Text>
      </Pressable>
    </Animated.View>
  )
}

export function SyncBadge() {
  const status = useStore((s) => s.syncStatus)
  const locale = useStore((s) => s.locale)

  const label =
    status === 'disabled'
      ? translate(locale, 'sync.localOnly')
      : status === 'offline'
        ? translate(locale, 'sync.offline')
        : status === 'error'
          ? translate(locale, 'sync.error')
          : status === 'idle'
            ? translate(locale, 'sync.synced')
            : translate(locale, 'sync.syncing')

  const color =
    status === 'idle'
      ? darkColors.success
      : status === 'error' || status === 'offline'
        ? darkColors.danger
        : status === 'disabled'
          ? darkColors.textMuted
          : darkColors.primaryLight

  return (
    <View style={styles.sync} testID="sync-badge">
      <View style={[styles.syncDot, { backgroundColor: color }]} />
      <Text style={styles.syncLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

export function EmptyState() {
  const notes = useStore((s) => s.notes)
  const ready = useStore((s) => s.ready)
  const locale = useStore((s) => s.locale)

  if (!ready || notes.length > 0) return null

  return (
    <View style={styles.empty} pointerEvents="none" testID="empty-state">
      <Text style={styles.emptyMark}>✦</Text>
      <Text style={styles.emptyTitle}>{translate(locale, 'canvas.empty.title')}</Text>
      <Text style={styles.emptySubtitle}>{translate(locale, 'canvas.empty.subtitle')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    bottom: 32,
    left: space.md,
    right: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm + 2,
    paddingVertical: 11,
    paddingLeft: space.md,
    paddingRight: space.sm,
    borderRadius: radii.full,
    backgroundColor: darkColors.surfaceHigh,
    borderWidth: 1,
    borderColor: darkColors.borderStrong,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  star: { color: '#FFE9B8', fontSize: 15 },
  pillText: { flex: 1, color: darkColors.text, fontSize: 13 },
  accept: {
    backgroundColor: darkColors.primary,
    borderRadius: radii.full,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  acceptText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '700' },
  dismiss: { paddingHorizontal: 6, paddingVertical: 7 },
  dismissText: { color: darkColors.textMuted, fontSize: 12.5, fontWeight: '600' },

  toast: {
    position: 'absolute',
    bottom: 32,
    left: space.md,
    right: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md - 4,
    paddingHorizontal: space.md + 4,
    borderRadius: radii.md,
    backgroundColor: darkColors.surfaceHigh,
    borderWidth: 1,
    borderColor: darkColors.borderStrong,
    elevation: 12,
  },
  toastText: { color: darkColors.text, fontSize: 14 },
  toastAction: { color: darkColors.primaryLight, fontSize: 14, fontWeight: '700' },

  sync: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.sm + 2,
    paddingVertical: 6,
    borderRadius: radii.full,
    backgroundColor: darkColors.surfaceGlass,
    borderWidth: 1,
    borderColor: darkColors.border,
  },
  syncDot: { width: 7, height: 7, borderRadius: 4 },
  syncLabel: { color: darkColors.textSub, fontSize: 11.5, fontWeight: '500' },

  empty: {
    // Spelled out rather than spreading StyleSheet.absoluteFillObject, which
    // React Native 0.86 no longer declares in its public types.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptyMark: { fontSize: 32, color: 'rgba(255,255,255,0.14)', marginBottom: 4 },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.6,
    color: 'rgba(255,255,255,0.2)',
  },
  emptySubtitle: { fontSize: 13.5, color: 'rgba(255,255,255,0.13)', textAlign: 'center' },
})
