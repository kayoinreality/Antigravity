import type { Note, NoteLink, NoteSystem } from '@antigravity/core'

/**
 * Translation between the database's snake_case timestamptz rows and the
 * camelCase epoch-millisecond objects the app works in.
 *
 * Kept in one file, in both directions, because the failure mode when these
 * drift is silent: a mistyped field name produces `undefined`, which becomes
 * `null` in JSON, which the server stores as an empty title. Explicit mapping
 * turns that into a compile error instead.
 */

export interface NoteRow {
  id: string
  user_id: string
  title: string
  content: string
  x: number
  y: number
  color: string
  tags: string[] | null
  system_id: string | null
  orbit_radius: number | null
  orbit_angle: number | null
  pinned: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
  rev: number
}

export interface SystemRow {
  id: string
  user_id: string
  label: string
  terms: string[] | null
  centroid_x: number
  centroid_y: number
  accepted_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  rev: number
}

export interface LinkRow {
  id: string
  user_id: string
  from_id: string
  to_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  rev: number
}

const ms = (value: string | null): number | null =>
  value === null ? null : new Date(value).getTime()

const msRequired = (value: string): number => new Date(value).getTime()

export function noteFromRow(row: NoteRow): Note {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    content: row.content,
    x: row.x,
    y: row.y,
    color: row.color,
    tags: row.tags ?? [],
    systemId: row.system_id,
    orbitRadius: row.orbit_radius,
    orbitAngle: row.orbit_angle,
    pinned: row.pinned,
    createdAt: msRequired(row.created_at),
    updatedAt: msRequired(row.updated_at),
    deletedAt: ms(row.deleted_at),
    rev: row.rev,
    // Anything that came from the server is by definition acknowledged.
    dirty: false,
  }
}

export function systemFromRow(row: SystemRow): NoteSystem {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    terms: row.terms ?? [],
    centroidX: row.centroid_x,
    centroidY: row.centroid_y,
    acceptedAt: ms(row.accepted_at),
    createdAt: msRequired(row.created_at),
    updatedAt: msRequired(row.updated_at),
    deletedAt: ms(row.deleted_at),
    rev: row.rev,
    dirty: false,
  }
}

export function linkFromRow(row: LinkRow): NoteLink {
  return {
    id: row.id,
    userId: row.user_id,
    fromId: row.from_id,
    toId: row.to_id,
    createdAt: msRequired(row.created_at),
    updatedAt: msRequired(row.updated_at),
    deletedAt: ms(row.deleted_at),
    rev: row.rev,
    dirty: false,
  }
}

/**
 * Outbound payloads. `user_id`, `rev` and the search vector are all
 * server-assigned, so they are absent here on purpose — sending them would
 * either be ignored or, worse, let a client claim a revision it did not earn.
 */

export function noteToWire(note: Note): Record<string, unknown> {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    x: note.x,
    y: note.y,
    color: note.color,
    tags: note.tags,
    systemId: note.systemId,
    orbitRadius: note.orbitRadius,
    orbitAngle: note.orbitAngle,
    pinned: note.pinned,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    deletedAt: note.deletedAt,
  }
}

export function systemToWire(system: NoteSystem): Record<string, unknown> {
  return {
    id: system.id,
    label: system.label,
    terms: system.terms,
    centroidX: system.centroidX,
    centroidY: system.centroidY,
    acceptedAt: system.acceptedAt,
    createdAt: system.createdAt,
    updatedAt: system.updatedAt,
    deletedAt: system.deletedAt,
  }
}

export function linkToWire(link: NoteLink): Record<string, unknown> {
  return {
    id: link.id,
    fromId: link.fromId,
    toId: link.toId,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
    deletedAt: link.deletedAt,
  }
}
