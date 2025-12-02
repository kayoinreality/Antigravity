import { StyleSheet } from 'react-native-unistyles'

// 1. Definimos nossos breakpoints (tamanhos de tela)
export const breakpoints = {
    xs: 0,
    sm: 576,
    md: 768,
    lg: 992,
    xl: 1200,
    superLarge: 2000,
} as const

// 2. Definimos nosso tema "Light" base
export const lightTheme = {
    colors: {
        primary: '#6C63FF',
        background: '#FFFFFF',
        text: '#000000',
        card: '#F5F5F5',
    },
    margins: {
        sm: 8,
        md: 16,
        lg: 24,
    },
} as const

// 3. Definimos nosso tema "Dark"
export const darkTheme = {
    colors: {
        primary: '#8A84FF',
        background: '#121212',
        text: '#FFFFFF',
        card: '#1E1E1E',
    },
    margins: {
        sm: 8,
        md: 16,
        lg: 24,
    },
} as const

// TypeScript types para ajudar no autocomplete
type AppBreakpoints = typeof breakpoints
type AppThemes = {
    light: typeof lightTheme
    dark: typeof darkTheme
}

// Sobrescrevendo os tipos da biblioteca para termos Intellisense
declare module 'react-native-unistyles' {
    export interface UnistylesBreakpoints extends AppBreakpoints { }
    export interface UnistylesThemes extends AppThemes { }
}

// 4. Registro final no C++
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