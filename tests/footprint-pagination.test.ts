import { describe, expect, it } from 'vitest'

const { parsePageLimit, parseCursor, pageFromRows } = require('../cloudfunctions/footprintMutation/pagination.js')

describe('footprint summary pagination', () => {
  const row = (id: string, updatedAt = 10) => ({ _id: id, updatedAt })

  it('returns a cursor only when another row exists, including the 100-row boundary', () => {
    const rows = Array.from({ length: 101 }, (_, index) => row(`id_${String(101 - index).padStart(3, '0')}`))
    const first = pageFromRows(rows, 100, (item: any) => item)
    expect(first.items).toHaveLength(100)
    expect(first.hasMore).toBe(true)
    expect(parseCursor(first.nextCursor)).toEqual({ updatedAt: 10, id: 'id_002' })
    expect(pageFromRows(rows.slice(0, 100), 100, (item: any) => item)).toMatchObject({
      hasMore: false, nextCursor: null,
    })
  })

  it('rejects malformed limits and cursors', () => {
    expect(parsePageLimit(undefined)).toBe(100)
    expect(() => parsePageLimit(101)).toThrow()
    expect(() => parsePageLimit(0)).toThrow()
    expect(() => parseCursor('bad!')).toThrow()
    expect(() => parseCursor(Buffer.from(JSON.stringify([10, '../other'])).toString('base64url'))).toThrow()
  })
})
