/**
 * Domain model shared by every platform.
 *
 * Two rules govern this file:
 *  1. Timestamps are epoch milliseconds. The server stores timestamptz and the
 *     adapters convert at the boundary, so nothing above the adapter has to
 *     think about timezones.
 *  2. Deletion is a tombstone (`deletedAt`), never a row removal. Undo and
 *     cross-device sync then share one mechanism instead of two.
 */

export type NoteId = string
export type SystemId = string
export type UserId = string

export interface Note {
  id: NoteId
  /** null while the user is anonymous; stamped on sign-in by `claimLocalNotes`. */
  userId: UserId | null
  title: string
  content: string
  /** World coordinates. The canvas is unbounded, so these are plain floats. */
  x: number
  y: number
  color: string
  tags: string[]
  /** Set when the note has been pulled into a solar system. */
  systemId: SystemId | null
  orbitRadius: number | null
  orbitAngle: number | null
  pinned: boolean
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  /** Server-assigned revision counter. 0 means "never reached the server". */
  rev: number
  /** Local-only: this row has changes the server has not acknowledged. */
  dirty: boolean
}

export interface NoteSystem {
  id: SystemId
  userId: UserId | null
  label: string
  /** The terms that made this cluster cohere; used to explain the grouping. */
  terms: string[]
  centroidX: number
  centroidY: number
  /** null while the system is only a suggestion the user has not accepted. */
  acceptedAt: number | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  rev: number
  dirty: boolean
}

export interface NoteLink {
  id: string
  userId: UserId | null
  fromId: NoteId
  toId: NoteId
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  rev: number
  dirty: boolean
}

/** The subset of a note the renderer needs. Kept flat and primitive-only so it
 *  can cross into a Reanimated worklet without serialization surprises. */
export interface NoteRenderData {
  id: NoteId
  x: number
  y: number
  width: number
  height: number
  color: string
  title: string
  preview: string
  updatedAt: number
  systemId: SystemId | null
  pinned: boolean
}

export const NOTE_WIDTH = 200
export const NOTE_HEIGHT = 132

export type NewNoteInput = Partial<
  Pick<Note, 'title' | 'content' | 'color' | 'tags' | 'x' | 'y' | 'userId'>
>

export type NoteUpdate = Partial<
  Pick<
    Note,
    | 'title'
    | 'content'
    | 'color'
    | 'tags'
    | 'x'
    | 'y'
    | 'pinned'
    | 'systemId'
    | 'orbitRadius'
    | 'orbitAngle'
  >
>
