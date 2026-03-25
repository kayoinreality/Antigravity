import { createContext, useContext } from 'react'
import type { SharedValue } from 'react-native-reanimated'

export interface CanvasTransform {
  translateX: SharedValue<number>
  translateY: SharedValue<number>
  scale: SharedValue<number>
  screenW: number
  screenH: number
}

export const CanvasContext = createContext<CanvasTransform | null>(null)

export function useCanvasTransform(): CanvasTransform {
  const ctx = useContext(CanvasContext)
  if (!ctx) throw new Error('Must be inside CanvasContext.Provider')
  return ctx
}