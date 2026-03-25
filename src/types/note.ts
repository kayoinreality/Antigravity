export interface Note {
  id: string
  title: string
  content: string
  x: number
  y: number
  color: string
  connections: string[]
  createdAt: number
  updatedAt: number
}

export type NoteColor =
  | '#FFE566'
  | '#FF9A9E'
  | '#74B9FF'
  | '#55EFC4'
  | '#FDCB6E'
  | '#D4A5FF'
  | '#FD79A8'
  | '#6C5CE7'

export const NOTE_COLORS: NoteColor[] = [
  '#FFE566',
  '#FF9A9E',
  '#74B9FF',
  '#55EFC4',
  '#FDCB6E',
  '#D4A5FF',
  '#FD79A8',
  '#6C5CE7',
]

export const NOTE_WIDTH = 180
export const NOTE_MIN_HEIGHT = 110