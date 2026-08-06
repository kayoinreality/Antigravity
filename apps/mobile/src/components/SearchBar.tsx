import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { removeSpan, darkColors, radii, space, translate } from '@antigravity/core'
import { useStore } from '../state/store'

/**
 * The single search field. No filter buttons anywhere — what the parser
 * recognised appears as dismissible chips, which is what makes an implicit
 * query language honest rather than magic.
 */
export function SearchBar() {
  const query = useStore((s) => s.query)
  const setQuery = useStore((s) => s.setQuery)
  const search = useStore((s) => s.search)
  const notes = useStore((s) => s.notes)
  const locale = useStore((s) => s.locale)
  const [focused, setFocused] = useState(false)

  const chips = search?.parsed.chips ?? []
  const count = search?.results.length ?? 0

  return (
    <View style={styles.container}>
      <View style={[styles.field, focused && styles.fieldFocused]}>
        <Text style={styles.icon}>⌕</Text>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={(next) => void setQuery(next)}
          placeholder={translate(locale, 'search.placeholder')}
          placeholderTextColor={darkColors.textMuted}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          testID="search-input"
        />
        {query.length > 0 && (
          <Pressable
            onPress={() => void setQuery('')}
            hitSlop={12}
            accessibilityLabel={translate(locale, 'search.clear')}
          >
            <Text style={styles.clear}>✕</Text>
          </Pressable>
        )}
      </View>

      {chips.length > 0 && (
        <View style={styles.chips}>
          {chips.map((chip) => (
            <Pressable
              key={chip.id}
              style={styles.chip}
              onPress={() => void setQuery(removeSpan(query, chip.span))}
              accessibilityLabel={`${chip.detail}. ${translate(locale, 'search.chip.remove')}`}
            >
              <Text style={styles.chipLabel}>{chip.label}</Text>
              <Text style={styles.chipRemove}>✕</Text>
            </Pressable>
          ))}
        </View>
      )}

      {search && (
        <Text style={styles.count}>
          {count === 0
            ? translate(locale, 'search.results.none')
            : translate(locale, 'search.results.count', { count, total: notes.length })}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: space.sm,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm + 2,
    height: 46,
    paddingHorizontal: space.md - 2,
    borderRadius: radii.md,
    backgroundColor: darkColors.surfaceGlass,
    borderWidth: 1,
    borderColor: darkColors.border,
  },
  fieldFocused: {
    borderColor: darkColors.primaryLight,
  },
  icon: {
    color: darkColors.textMuted,
    fontSize: 17,
  },
  input: {
    flex: 1,
    color: darkColors.text,
    fontSize: 15,
    padding: 0,
  },
  clear: {
    color: darkColors.textMuted,
    fontSize: 14,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingLeft: 10,
    paddingRight: 8,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: darkColors.borderStrong,
    backgroundColor: 'rgba(108,92,231,0.2)',
  },
  chipLabel: {
    color: darkColors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  chipRemove: {
    color: darkColors.textMuted,
    fontSize: 10,
  },
  count: {
    color: darkColors.textMuted,
    fontSize: 12,
    paddingLeft: 4,
  },
})
