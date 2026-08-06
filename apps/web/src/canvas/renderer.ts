import {
  Lod,
  discAngle,
  lodForScale,
  singularityX,
  singularityY,
  worldToScreenX,
  worldToScreenY,
  type BlackHoleVisual,
  type Camera,
  type Viewport,
} from '@antigravity/canvas-engine'
import { NOTE_HEIGHT, NOTE_WIDTH, darkColors, type Note, type NoteLink, type NoteSystem } from '@antigravity/core'

/**
 * Canvas2D renderer.
 *
 * One canvas element, one draw call per frame, everything else is arithmetic.
 * The DOM is not involved in drawing notes at all — a thousand absolutely
 * positioned divs is exactly the trap the previous build fell into, and no
 * amount of React memoization rescues it.
 *
 * Text is the expensive part (measureText forces layout), so wrapped lines are
 * cached per note and only recomputed when the note's text changes.
 */

export interface RenderState {
  camera: Camera
  viewport: Viewport
  notes: Note[]
  visible: Int32Array
  visibleCount: number
  systems: NoteSystem[]
  links: NoteLink[]
  selectedId: string | null
  /** null when not searching; otherwise the notes that matched. */
  matched: Set<string> | null
  /** Note currently held by the pointer, drawn last and detached. */
  draggingId: string | null
  blackHole: BlackHoleVisual | null
  /**
   * Animated positions, keyed by note id. Present only while a note is
   * travelling somewhere — orbital insertion, escaping a system. The store
   * already holds the destination; this is purely how it gets there.
   */
  positions: Map<string, { x: number; y: number }> | null
  elapsed: number
}

interface WrappedText {
  key: string
  lines: string[]
}

const wrapCache = new Map<string, WrappedText>()

/** Rebuilt lazily; bounded so a long session cannot grow it without limit. */
const MAX_WRAP_CACHE = 4000

export function render(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const { camera, viewport } = state
  const dpr = window.devicePixelRatio || 1

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, viewport.width, viewport.height)

  drawBackground(ctx, state)
  drawLinks(ctx, state)
  drawSystems(ctx, state)

  const lod = lodForScale(camera.scale)
  const byId = new Map(state.notes.map((n) => [n.id, n]))

  for (let i = 0; i < state.visibleCount; i++) {
    const note = state.notes[state.visible[i]!]
    if (!note || note.id === state.draggingId) continue
    drawNote(ctx, note, state, lod)
  }

  // The dragged note is drawn last so it floats above everything, and separately
  // because the black hole may have displaced and deformed it.
  if (state.draggingId) {
    const note = byId.get(state.draggingId)
    if (note) drawDraggedNote(ctx, note, state, lod)
  }

  if (state.blackHole && state.blackHole.presence > 0) {
    drawBlackHole(ctx, state)
  }
}

function drawBackground(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const { viewport, camera } = state

  ctx.fillStyle = darkColors.void
  ctx.fillRect(0, 0, viewport.width, viewport.height)

  // A parallax starfield, seeded from world position so stars stay put as the
  // camera moves. Without something fixed in the background, panning an empty
  // region gives no sense of motion at all.
  const spacing = 160
  const parallax = 0.35
  const offsetX = camera.x * parallax
  const offsetY = camera.y * parallax

  const startX = Math.floor(-offsetX / spacing) * spacing
  const startY = Math.floor(-offsetY / spacing) * spacing

  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  for (let x = startX; x < startX + viewport.width + spacing; x += spacing) {
    for (let y = startY; y < startY + viewport.height + spacing; y += spacing) {
      // Cheap deterministic hash so the field looks scattered, not gridded.
      const jitter = ((x * 73856093) ^ (y * 19349663)) >>> 0
      const dx = (jitter % 97) / 97
      const dy = ((jitter >> 8) % 89) / 89
      const size = ((jitter >> 16) % 10) / 10

      if (size < 0.35) continue
      ctx.globalAlpha = 0.22 + size * 0.5
      ctx.fillRect(x + offsetX + dx * spacing, y + offsetY + dy * spacing, 1.6, 1.6)
    }
  }
  ctx.globalAlpha = 1
}

function drawLinks(ctx: CanvasRenderingContext2D, state: RenderState): void {
  if (state.links.length === 0) return

  const byId = new Map(state.notes.map((n) => [n.id, n]))
  const at = (note: Note) => state.positions?.get(note.id) ?? note
  ctx.strokeStyle = darkColors.link
  ctx.lineWidth = Math.max(1, 1.5 * state.camera.scale)
  ctx.beginPath()

  for (const link of state.links) {
    if (link.deletedAt !== null) continue
    const from = byId.get(link.fromId)
    const to = byId.get(link.toId)
    if (!from || !to) continue

    const a = at(from)
    const b = at(to)
    ctx.moveTo(
      worldToScreenX(a.x + NOTE_WIDTH / 2, state.camera),
      worldToScreenY(a.y + NOTE_HEIGHT / 2, state.camera),
    )
    ctx.lineTo(
      worldToScreenX(b.x + NOTE_WIDTH / 2, state.camera),
      worldToScreenY(b.y + NOTE_HEIGHT / 2, state.camera),
    )
  }

  ctx.stroke()
}

function drawSystems(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const { camera } = state

  for (const system of state.systems) {
    if (system.deletedAt !== null) continue

    const cx = worldToScreenX(system.centroidX, camera)
    const cy = worldToScreenY(system.centroidY, camera)

    const radii = new Set<number>()
    for (const note of state.notes) {
      if (note.systemId === system.id && note.orbitRadius !== null) radii.add(note.orbitRadius)
    }

    ctx.strokeStyle = darkColors.orbit
    ctx.lineWidth = 1
    for (const radius of radii) {
      ctx.beginPath()
      ctx.arc(cx, cy, radius * camera.scale, 0, Math.PI * 2)
      ctx.stroke()
    }

    // The star: a glow plus a core, sized so it stays readable while zoomed out.
    const coreRadius = Math.max(5, 14 * camera.scale)
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius * 4)
    glow.addColorStop(0, 'rgba(255, 236, 190, 0.55)')
    glow.addColorStop(1, 'rgba(255, 236, 190, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, cy, coreRadius * 4, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#FFF3D6'
    ctx.beginPath()
    ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2)
    ctx.fill()

    if (camera.scale > 0.25 && system.label) {
      ctx.font = `700 ${Math.max(11, 13 * camera.scale)}px ui-rounded, system-ui, sans-serif`
      ctx.fillStyle = darkColors.text
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(system.label, cx, cy + coreRadius + 8)
      ctx.textAlign = 'left'
    }
  }
}

function noteAlpha(note: Note, state: RenderState): number {
  if (!state.matched) return 1
  // Spotlight: non-matches recede to a dim star rather than disappearing, so
  // the shape of the canvas stays legible while searching.
  return state.matched.has(note.id) ? 1 : 0.1
}

function drawNote(
  ctx: CanvasRenderingContext2D,
  note: Note,
  state: RenderState,
  lod: Lod,
): void {
  const { camera } = state
  const at = state.positions?.get(note.id)
  const x = worldToScreenX(at?.x ?? note.x, camera)
  const y = worldToScreenY(at?.y ?? note.y, camera)
  const width = NOTE_WIDTH * camera.scale
  const height = NOTE_HEIGHT * camera.scale

  const alpha = noteAlpha(note, state)
  const isMatch = state.matched?.has(note.id) ?? false
  const isSelected = state.selectedId === note.id

  ctx.globalAlpha = alpha

  if (lod === Lod.Star || (state.matched && !isMatch)) {
    ctx.fillStyle = note.color
    ctx.beginPath()
    ctx.arc(x + width / 2, y + height / 2, 3.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    return
  }

  if (isMatch) {
    // A match glows in its own colour. An earlier version painted a white
    // radial gradient across a rect behind the card, which at this contrast
    // read as a grey smudge rather than light.
    ctx.save()
    ctx.shadowColor = note.color
    ctx.shadowBlur = 26
    drawCard(ctx, note, x, y, width, height, camera.scale, lod, isSelected)
    ctx.restore()
    ctx.globalAlpha = 1
    return
  }

  drawCard(ctx, note, x, y, width, height, camera.scale, lod, isSelected)
  ctx.globalAlpha = 1
}

function drawDraggedNote(
  ctx: CanvasRenderingContext2D,
  note: Note,
  state: RenderState,
  lod: Lod,
): void {
  const { camera, blackHole } = state
  const width = NOTE_WIDTH * camera.scale
  const height = NOTE_HEIGHT * camera.scale

  ctx.save()

  if (blackHole && blackHole.pull > 0) {
    // Spaghettification: rotate into the pull axis, stretch along it, squeeze
    // across it. Drawing this by transforming the context means the card's own
    // rendering code does not have to know it is being eaten.
    ctx.translate(blackHole.noteX, blackHole.noteY)
    ctx.rotate(blackHole.rotation)
    ctx.scale(blackHole.squeeze, blackHole.stretch)

    // Anchor the stretch to the leading edge — the one facing the singularity —
    // so the note trails away from it. Scaling about the centre instead sends
    // half the card straight through the black hole and out the far side, which
    // is the one thing the effect must not do.
    const stretch = Math.max(blackHole.stretch, 0.001)
    ctx.translate(0, height / 2 - height / (2 * stretch))

    ctx.globalAlpha = 1 - blackHole.drain * 0.35
    drawCard(ctx, note, -width / 2, -height / 2, width, height, camera.scale, lod, false, blackHole.drain)
  } else {
    const at = state.positions?.get(note.id)
    const x = worldToScreenX(at?.x ?? note.x, camera)
    const y = worldToScreenY(at?.y ?? note.y, camera)
    ctx.shadowColor = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = 28
    ctx.shadowOffsetY = 10
    ctx.translate(x + width / 2, y + height / 2)
    ctx.rotate(0.035)
    ctx.scale(1.05, 1.05)
    drawCard(ctx, note, -width / 2, -height / 2, width, height, camera.scale, lod, true)
  }

  ctx.restore()
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  note: Note,
  x: number,
  y: number,
  width: number,
  height: number,
  scale: number,
  lod: Lod,
  selected: boolean,
  drain = 0,
): void {
  const radius = Math.min(16 * scale, width / 2)

  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
  ctx.fillStyle = drain > 0 ? blendToWhite(note.color, drain) : note.color
  ctx.fill()

  if (selected) {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 2
    ctx.stroke()
  }

  if (lod === Lod.Star || width < 40) return

  const padding = 14 * scale
  ctx.fillStyle = darkColors.onNote
  ctx.textBaseline = 'top'

  const title = note.title.trim() || note.content.trim().split('\n')[0] || ''
  if (title) {
    ctx.font = `700 ${Math.max(8, 15 * scale)}px ui-rounded, system-ui, sans-serif`
    ctx.fillText(clip(ctx, title, width - padding * 2), x + padding, y + padding)
  }

  if (lod !== Lod.Full) return

  const body = note.title.trim()
    ? note.content.trim()
    : note.content.trim().split('\n').slice(1).join(' ')

  if (!body) return

  ctx.font = `400 ${Math.max(8, 12 * scale)}px system-ui, sans-serif`
  ctx.globalAlpha = ctx.globalAlpha * 0.72

  const lineHeight = 16 * scale
  const maxLines = Math.max(0, Math.floor((height - padding * 2 - 22 * scale) / lineHeight))
  const lines = wrapText(ctx, note.id, body, width - padding * 2, maxLines)

  lines.forEach((line, i) => {
    ctx.fillText(line, x + padding, y + padding + 22 * scale + i * lineHeight)
  })

  ctx.globalAlpha = ctx.globalAlpha / 0.72
}

function clip(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text

  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) low = mid
    else high = mid - 1
  }
  return `${text.slice(0, low)}…`
}

/**
 * Word wrap with a per-note cache.
 *
 * measureText is the single most expensive call in this renderer, and the same
 * note gets drawn every frame while panning. The cache key includes the width
 * so a zoom change invalidates it, which is exactly when the wrap really does
 * need redoing.
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  noteId: string,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const key = `${text.length}:${Math.round(maxWidth)}:${maxLines}:${ctx.font}`
  const cached = wrapCache.get(noteId)
  if (cached && cached.key === key) return cached.lines

  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    current = word
    if (lines.length >= maxLines) break
  }

  if (current && lines.length < maxLines) lines.push(current)
  if (lines.length > maxLines) lines.length = maxLines

  if (wrapCache.size > MAX_WRAP_CACHE) wrapCache.clear()
  wrapCache.set(noteId, { key, lines })
  return lines
}

export function invalidateWrap(noteId: string): void {
  wrapCache.delete(noteId)
}

function blendToWhite(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

function drawBlackHole(ctx: CanvasRenderingContext2D, state: RenderState): void {
  const visual = state.blackHole!
  const cx = singularityX(state.viewport.width)
  const cy = singularityY(state.viewport.height, {
    armDistanceRatio: 0.12,
    armVelocity: -220,
    horizonRadius: 88,
    centreYRatio: 0.14,
    influenceRadius: 420,
  })

  const presence = visual.presence
  const horizon = 88

  ctx.save()
  ctx.globalAlpha = presence

  // Lensing halo: light bending around the mass, brightest just outside the
  // horizon and falling off fast.
  const lens = ctx.createRadialGradient(cx, cy, horizon * 0.9, cx, cy, horizon * 3.4)
  lens.addColorStop(0, 'rgba(180, 140, 255, 0.40)')
  lens.addColorStop(0.35, 'rgba(122, 63, 255, 0.16)')
  lens.addColorStop(1, 'rgba(122, 63, 255, 0)')
  ctx.fillStyle = lens
  ctx.beginPath()
  ctx.arc(cx, cy, horizon * 3.4, 0, Math.PI * 2)
  ctx.fill()

  // Accretion disc: an arc swept around the horizon, rotating over time.
  const angle = discAngle(state.elapsed)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  ctx.scale(1, 0.32) // flatten into a disc seen near edge-on
  const disc = ctx.createRadialGradient(0, 0, horizon * 0.95, 0, 0, horizon * 2.1)
  disc.addColorStop(0, 'rgba(255, 208, 138, 0.9)')
  disc.addColorStop(0.5, 'rgba(255, 138, 90, 0.5)')
  disc.addColorStop(1, 'rgba(122, 63, 255, 0)')
  ctx.strokeStyle = disc
  ctx.lineWidth = horizon * 0.5
  ctx.beginPath()
  ctx.arc(0, 0, horizon * 1.35, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  // The event horizon itself: absolute black, with a hard edge.
  ctx.fillStyle = '#000000'
  ctx.beginPath()
  ctx.arc(cx, cy, horizon * (visual.willCapture ? 1.06 : 1), 0, Math.PI * 2)
  ctx.fill()

  if (visual.willCapture) {
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'
    ctx.lineWidth = 2
    ctx.stroke()
  }

  ctx.restore()
}
