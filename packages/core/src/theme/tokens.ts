/**
 * Design tokens as plain objects — no Unistyles, no StyleSheet — because both
 * the React Native app and the DOM app read from this file.
 *
 * The dark values carry over from the previous build's palette; the app is a
 * night sky, so dark is the primary theme and light is the adaptation.
 */

export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const

export const radii = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  full: 9999,
} as const

export const duration = {
  instant: 90,
  fast: 180,
  base: 260,
  slow: 450,
  orbit: 700,
} as const

export const darkColors = {
  void: '#07070F',
  voidDeep: '#04040A',
  surface: '#13131F',
  surfaceHigh: '#1C1C2E',
  surfaceGlass: 'rgba(28,28,46,0.72)',
  primary: '#6C5CE7',
  primaryLight: '#A29BFE',
  text: '#FFFFFF',
  textSub: 'rgba(255,255,255,0.58)',
  textMuted: 'rgba(255,255,255,0.26)',
  onNote: '#14142B',
  danger: '#FF6B6B',
  success: '#5AE6BE',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',
  backdrop: 'rgba(4,4,10,0.86)',
  star: 'rgba(255,255,255,0.55)',
  starDim: 'rgba(255,255,255,0.16)',
  orbit: 'rgba(162,155,254,0.22)',
  link: 'rgba(255,255,255,0.22)',
  horizon: '#000000',
  accretionInner: '#FFD08A',
  accretionOuter: '#7A3FFF',
} as const

export const lightColors = {
  ...darkColors,
  void: '#EEEEF6',
  voidDeep: '#E2E2EE',
  surface: '#FFFFFF',
  surfaceHigh: '#F7F7FD',
  surfaceGlass: 'rgba(255,255,255,0.82)',
  text: '#12121F',
  textSub: 'rgba(18,18,31,0.62)',
  textMuted: 'rgba(18,18,31,0.32)',
  border: 'rgba(0,0,0,0.08)',
  borderStrong: 'rgba(0,0,0,0.14)',
  backdrop: 'rgba(238,238,246,0.86)',
  star: 'rgba(18,18,31,0.5)',
  starDim: 'rgba(18,18,31,0.14)',
  orbit: 'rgba(108,92,231,0.24)',
  link: 'rgba(18,18,31,0.18)',
} as const

/** Widened to `string`: the light theme overrides values, so the literal types
 *  inferred from `darkColors` would reject it. */
export type ThemeColors = Record<keyof typeof darkColors, string>
export type ThemeName = 'dark' | 'light'

export const themes: Record<ThemeName, ThemeColors> = {
  dark: darkColors,
  light: lightColors,
}

export const typeScale = {
  cardTitle: { size: 15, weight: 700, lineHeight: 19 },
  cardBody: { size: 12, weight: 400, lineHeight: 16 },
  cardMeta: { size: 10, weight: 500, lineHeight: 13 },
  starLabel: { size: 13, weight: 700, lineHeight: 17 },
  h1: { size: 26, weight: 800, lineHeight: 31 },
  body: { size: 16, weight: 400, lineHeight: 24 },
  label: { size: 13, weight: 600, lineHeight: 17 },
  caption: { size: 12, weight: 500, lineHeight: 16 },
} as const
