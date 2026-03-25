import { View } from 'react-native'
import type { Note } from '../../types/note'
import { NOTE_MIN_HEIGHT, NOTE_WIDTH } from '../../types/note'

interface Props {
  fromNote: Note
  toNote: Note
}

const NOTE_CENTER_X = NOTE_WIDTH / 2
const NOTE_CENTER_Y = NOTE_MIN_HEIGHT / 2

export default function ConnectionLine({ fromNote, toNote }: Props) {
  const x1 = fromNote.x + NOTE_CENTER_X
  const y1 = fromNote.y + NOTE_CENTER_Y
  const x2 = toNote.x + NOTE_CENTER_X
  const y2 = toNote.y + NOTE_CENTER_Y

  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.sqrt(dx * dx + dy * dy)
  const angle = Math.atan2(dy, dx) * (180 / Math.PI)

  if (length < 1) return null

  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: midX - length / 2,
        top: midY - 1.5,
        width: length,
        height: 3,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.25)',
        transform: [{ rotate: `${angle}deg` }],
      }}
    />
  )
}
