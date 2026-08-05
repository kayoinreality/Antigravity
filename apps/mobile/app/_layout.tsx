import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as SplashScreen from 'expo-splash-screen'
import { darkColors } from '@antigravity/core'
import { useStore } from '../src/state/store'

void SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const init = useStore((s) => s.init)
  const ready = useStore((s) => s.ready)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    // Held until SQLite has opened and the notes are in memory, so the canvas
    // never flashes empty before the user's own notes appear.
    if (ready) void SplashScreen.hideAsync()
  }, [ready])

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: darkColors.void }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: darkColors.void },
          animation: 'fade',
        }}
      />
      <StatusBar style="light" />
    </GestureHandlerRootView>
  )
}
