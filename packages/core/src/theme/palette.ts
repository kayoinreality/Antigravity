/**
 * Note colours, named after what they look like against the deep-space
 * background. Names double as search terms — `cor:âmbar` / `color:amber`
 * resolves through `matchColorName`, so every alias here is user-facing.
 */

import { stripAccents } from '../text/normalize'

export interface PaletteEntry {
  hex: string
  /** Canonical key used in storage-adjacent code and tests. */
  key: string
  aliases: { pt: string[]; en: string[] }
}

export const NOTE_PALETTE: PaletteEntry[] = [
  {
    hex: '#FFD966',
    key: 'amber',
    aliases: { pt: ['âmbar', 'ambar', 'amarelo', 'amarela'], en: ['amber', 'yellow'] },
  },
  {
    hex: '#FF8FA3',
    key: 'nova',
    aliases: { pt: ['rosa', 'nova'], en: ['pink', 'rose', 'nova'] },
  },
  {
    hex: '#6FB4FF',
    key: 'cyan',
    aliases: { pt: ['azul', 'ciano'], en: ['blue', 'cyan'] },
  },
  {
    hex: '#5AE6BE',
    key: 'aurora',
    aliases: { pt: ['verde', 'aurora'], en: ['green', 'mint', 'aurora'] },
  },
  {
    hex: '#FFA96B',
    key: 'ember',
    aliases: { pt: ['laranja', 'brasa'], en: ['orange', 'ember'] },
  },
  {
    hex: '#C4A2FF',
    key: 'nebula',
    aliases: { pt: ['roxo', 'roxa', 'lilás', 'lilas', 'nebulosa'], en: ['purple', 'violet', 'nebula'] },
  },
  {
    hex: '#F87BC4',
    key: 'magenta',
    aliases: { pt: ['magenta', 'pink'], en: ['magenta', 'fuchsia'] },
  },
  {
    hex: '#8AA4FF',
    key: 'comet',
    aliases: { pt: ['índigo', 'indigo', 'cometa'], en: ['indigo', 'comet'] },
  },
]

const COLOR_LOOKUP: Map<string, string> = (() => {
  const map = new Map<string, string>()
  for (const entry of NOTE_PALETTE) {
    map.set(entry.key, entry.hex)
    map.set(entry.hex.toLowerCase(), entry.hex)
    for (const alias of [...entry.aliases.pt, ...entry.aliases.en]) {
      map.set(stripAccents(alias.toLowerCase()), entry.hex)
    }
  }
  return map
})()

/** Resolves a user-typed colour word to a palette hex, or null if unknown. */
export function matchColorName(input: string): string | null {
  return COLOR_LOOKUP.get(stripAccents(input.trim().toLowerCase())) ?? null
}

export function colorKey(hex: string): string {
  return NOTE_PALETTE.find((e) => e.hex.toLowerCase() === hex.toLowerCase())?.key ?? 'amber'
}
