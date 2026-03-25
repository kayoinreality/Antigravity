import { Platform } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'

export const breakpoints = {
    xs: 0,
    sm: 576,
    md: 768,
    lg: 992,
    xl: 1200,
} as const

export const darkTheme = {
    colors: {
        canvasBg: '#0d0d1a',
        surface: '#13131f',
        surfaceHigh: '#1c1c2e',
        primary: '#6C5CE7',
        primaryLight: '#A29BFE',
        text: '#FFFFFF',
        textSub: 'rgba(255,255,255,0.55)',
        textMuted: 'rgba(255,255,255,0.25)',
        error: '#FF6B6B',
        success: '#55EFC4',
        warning: '#FDCB6E',
        noteYellow: '#FFE566',
        notePink: '#FF9A9E',
        noteBlue: '#74B9FF',
        noteMint: '#55EFC4',
        noteOrange: '#FDCB6E',
        notePurple: '#D4A5FF',
        noteRose: '#FD79A8',
        noteDark: '#6C5CE7',
        border: 'rgba(255,255,255,0.08)',
        borderStrong: 'rgba(255,255,255,0.15)',
        backdrop: 'rgba(13,13,26,0.85)',
        background: '#0d0d1a',
        card: '#13131f',
        tint: '#A29BFE',
        icon: 'rgba(255,255,255,0.5)',
    },
    spacing: {
        xs: 4,
        sm: 8,
        md: 16,
        lg: 24,
        xl: 32,
        xxl: 48,
    },
    radii: {
        sm: 8,
        md: 14,
        lg: 20,
        xl: 28,
        full: 9999,
    },
    typography: Platform.select({
        ios: {
            sans: 'system-ui',
            rounded: 'ui-rounded',
            mono: 'ui-monospace',
        },
        default: {
            sans: 'normal',
            rounded: 'normal',
            mono: 'monospace',
        },
        web: {
            sans: "system-ui, -apple-system, sans-serif",
            rounded: "'SF Pro Rounded', sans-serif",
            mono: "'SF Mono', monospace",
        },
    })!,
} as const

export const lightTheme = {
    ...darkTheme,
    colors: {
        ...darkTheme.colors,
        canvasBg: '#f0f0f8',
        surface: '#ffffff',
        surfaceHigh: '#f8f8ff',
        text: '#1a1a2e',
        textSub: 'rgba(26,26,46,0.6)',
        textMuted: 'rgba(26,26,46,0.3)',
        border: 'rgba(0,0,0,0.07)',
        borderStrong: 'rgba(0,0,0,0.12)',
        background: '#f0f0f8',
        card: '#ffffff',
        icon: 'rgba(26,26,46,0.4)',
    },
} as const

type AppBreakpoints = typeof breakpoints
type AppThemes = {
    light: typeof lightTheme
    dark: typeof darkTheme
}

declare module 'react-native-unistyles' {
    export interface UnistylesBreakpoints extends AppBreakpoints {}
    export interface UnistylesThemes extends AppThemes {}
}

StyleSheet.configure({
    breakpoints,
    themes: {
        light: lightTheme,
        dark: darkTheme,
    },
    settings: {
        adaptiveThemes: true,
    },
})

export const Colors = {
    light: { tint: lightTheme.colors.primary, ...lightTheme.colors },
    dark: { tint: darkTheme.colors.primaryLight, ...darkTheme.colors },
}

export const Fonts = Platform.select({
    ios: {
        sans: 'system-ui',
        serif: 'ui-serif',
        rounded: 'ui-rounded',
        mono: 'ui-monospace',
    },
    default: {
        sans: 'normal',
        serif: 'serif',
        rounded: 'normal',
        mono: 'monospace',
    },
    web: {
        sans: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        serif: "Georgia, serif",
        rounded: "'SF Pro Rounded', sans-serif",
        mono: "SFMono-Regular, monospace",
    },
})