import { describe, expect, it } from 'vitest'
import { acknowledge, decide, mergeRows, type Syncable } from './merge'

/**
 * These tests stand in for two devices editing the same canvas offline. The
 * property that matters is convergence: whatever order the pages arrive in,
 * both sides end up with the same row, and nothing a user typed is dropped
 * without the losing side getting another chance to push it.
 */

interface Row extends Syncable {
  text: string
}

const row = (over: Partial<Row> & { id: string }): Row => ({
  updatedAt: 1000,
  rev: 1,
  dirty: false,
  text: '',
  ...over,
})

describe('decide', () => {
  it('takes the remote row when there is no local copy', () => {
    expect(decide(undefined, row({ id: 'a' }))).toBe('remote')
  })

  it('takes whichever side was written later', () => {
    const local = row({ id: 'a', updatedAt: 2000 })
    const remote = row({ id: 'a', updatedAt: 3000 })
    expect(decide(local, remote)).toBe('remote')
    expect(decide(remote, local)).toBe('local')
  })

  it('falls back to the server revision inside the same millisecond', () => {
    const local = row({ id: 'a', updatedAt: 2000, rev: 4 })
    const remote = row({ id: 'a', updatedAt: 2000, rev: 5 })
    expect(decide(local, remote)).toBe('remote')
  })

  it('reports identical rows so they can stop being resent', () => {
    const same = row({ id: 'a', updatedAt: 2000, rev: 4 })
    expect(decide(same, { ...same })).toBe('identical')
  })
})

describe('mergeRows', () => {
  it('applies a newer server row and clears its dirty flag', () => {
    const { merged } = mergeRows(
      [row({ id: 'a', text: 'local', updatedAt: 1000, dirty: true })],
      [row({ id: 'a', text: 'server', updatedAt: 2000, rev: 7 })],
    )
    expect(merged).toEqual([expect.objectContaining({ text: 'server', dirty: false })])
  })

  it('keeps a newer local edit and marks it for the next push', () => {
    const local = row({ id: 'a', text: 'local', updatedAt: 3000, dirty: true })
    const { merged, stillDirty } = mergeRows([local], [row({ id: 'a', text: 'server', updatedAt: 2000 })])
    expect(merged).toHaveLength(0)
    expect(stillDirty).toEqual([local])
  })

  it('adopts rows it has never seen', () => {
    const { merged } = mergeRows([], [row({ id: 'new', text: 'from other device' })])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.dirty).toBe(false)
  })

  it('stops resending a dirty row the server already has', () => {
    const local = row({ id: 'a', updatedAt: 2000, rev: 3, dirty: true })
    const { merged } = mergeRows([local], [row({ id: 'a', updatedAt: 2000, rev: 3 })])
    expect(merged[0]).toMatchObject({ dirty: false, rev: 3 })
  })

  it('leaves a clean, already-current row untouched', () => {
    const local = row({ id: 'a', updatedAt: 2000, rev: 3, dirty: false })
    expect(mergeRows([local], [row({ id: 'a', updatedAt: 2000, rev: 3 })]).merged).toHaveLength(0)
  })

  it('propagates a tombstone as an ordinary newer write', () => {
    const local = row({ id: 'a', updatedAt: 1000 })
    const deleted = { ...row({ id: 'a', updatedAt: 5000, rev: 9 }), deletedAt: 5000 }
    const { merged } = mergeRows([local], [deleted as Row])
    expect(merged[0]).toMatchObject({ rev: 9 })
  })

  it('converges regardless of which device pushes first', () => {
    const deviceA = row({ id: 'a', text: 'from A', updatedAt: 5000, rev: 2, dirty: true })
    const deviceB = row({ id: 'a', text: 'from B', updatedAt: 4000, rev: 2, dirty: true })

    const aSeesB = mergeRows([deviceA], [deviceB]).merged
    const bSeesA = mergeRows([deviceB], [deviceA]).merged

    // A wrote later, so both devices must end up holding A's text.
    expect(aSeesB).toHaveLength(0) // A keeps its own, still dirty
    expect(bSeesA[0]!.text).toBe('from A')
  })
})

describe('acknowledge', () => {
  it('clears dirty and records the server revision', () => {
    const sent = [row({ id: 'a', updatedAt: 2000, dirty: true })]
    const current = new Map([['a', row({ id: 'a', updatedAt: 2000, dirty: true })]])
    const result = acknowledge(sent, [row({ id: 'a', updatedAt: 2000, rev: 12 })], current)
    expect(result).toEqual([expect.objectContaining({ rev: 12, dirty: false })])
  })

  it('leaves a row dirty when the user edited it while the push was in flight', () => {
    const sent = [row({ id: 'a', updatedAt: 2000, dirty: true })]
    const current = new Map([['a', row({ id: 'a', text: 'typed more', updatedAt: 9000, dirty: true })]])
    expect(acknowledge(sent, [row({ id: 'a', updatedAt: 2000, rev: 12 })], current)).toHaveLength(0)
  })

  it('ignores an acknowledgement for a row it never sent', () => {
    expect(acknowledge([], [row({ id: 'ghost' })], new Map())).toHaveLength(0)
  })
})
