import { uuid } from './id'
import {
  NOTE_HEIGHT,
  NOTE_WIDTH,
  type NewNoteInput,
  type Note,
  type NoteLink,
  type NoteRenderData,
  type NoteSystem,
  type NoteUpdate,
} from './types'
import { NOTE_PALETTE } from '../theme/palette'

/** Rotating palette so consecutive notes don't come out the same colour. */
export function pickColor(seed: number): string {
  return NOTE_PALETTE[Math.abs(Math.trunc(seed)) % NOTE_PALETTE.length]!.hex
}

export function createNote(input: NewNoteInput = {}, now = Date.now()): Note {
  return {
    id: uuid(),
    userId: input.userId ?? null,
    title: input.title ?? '',
    content: input.content ?? '',
    x: input.x ?? 0,
    y: input.y ?? 0,
    color: input.color ?? pickColor(now),
    tags: input.tags ?? [],
    systemId: null,
    orbitRadius: null,
    orbitAngle: null,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    rev: 0,
    dirty: true,
  }
}

export function applyUpdate(note: Note, update: NoteUpdate, now = Date.now()): Note {
  return { ...note, ...update, updatedAt: now, dirty: true }
}

export function softDelete(note: Note, now = Date.now()): Note {
  return { ...note, deletedAt: now, updatedAt: now, dirty: true }
}

export function restore(note: Note, now = Date.now()): Note {
  return { ...note, deletedAt: null, updatedAt: now, dirty: true }
}

export const isAlive = (note: Note): boolean => note.deletedAt === null

/**
 * Tags come from two places: the `tags` column and inline `#hashtags` in the
 * body. Search treats them identically, so resolve both here rather than in
 * every call site.
 */
const HASHTAG_RE = /(?:^|\s)#([\p{L}\p{N}_-]{1,40})/gu

export function extractTags(note: Pick<Note, 'title' | 'content' | 'tags'>): string[] {
  const found = new Set(note.tags.map((t) => t.toLowerCase()))
  for (const source of [note.title, note.content]) {
    for (const match of source.matchAll(HASHTAG_RE)) {
      found.add(match[1]!.toLowerCase())
    }
  }
  return [...found]
}

/** First non-empty line, falling back to the body — what shows on the card. */
export function displayTitle(note: Pick<Note, 'title' | 'content'>): string {
  const explicit = note.title.trim()
  if (explicit) return explicit
  const firstLine = note.content.trim().split('\n')[0]?.trim()
  return firstLine || ''
}

export function displayPreview(note: Pick<Note, 'title' | 'content'>): string {
  const body = note.content.trim()
  if (!body) return ''
  // When the title was derived from line 1, don't repeat that line below it.
  const lines = body.split('\n')
  const skipFirst = !note.title.trim() && lines.length > 0
  return (skipFirst ? lines.slice(1) : lines)
    .join('\n')
    .trim()
    .slice(0, 240)
}

export function toRenderData(note: Note): NoteRenderData {
  return {
    id: note.id,
    x: note.x,
    y: note.y,
    width: NOTE_WIDTH,
    height: NOTE_HEIGHT,
    color: note.color,
    title: displayTitle(note),
    preview: displayPreview(note),
    updatedAt: note.updatedAt,
    systemId: note.systemId,
    pinned: note.pinned,
  }
}

export function createSystem(
  label: string,
  terms: string[],
  centroidX: number,
  centroidY: number,
  now = Date.now(),
): NoteSystem {
  return {
    id: uuid(),
    userId: null,
    label,
    terms,
    centroidX,
    centroidY,
    acceptedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    rev: 0,
    dirty: true,
  }
}

export function createLink(fromId: string, toId: string, now = Date.now()): NoteLink {
  return {
    id: uuid(),
    userId: null,
    fromId,
    toId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    rev: 0,
    dirty: true,
  }
}

export { NOTE_HEIGHT, NOTE_WIDTH }
