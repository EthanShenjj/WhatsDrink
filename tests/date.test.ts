import { describe, it, expect } from 'vitest'
import { dateKey, todayKey, buildMonthGrid, formatVisitDate, daysUntil, addDays } from '../miniprogram/utils/date'
import type { Footprint } from '../miniprogram/domain/types'

describe('dateKey', () => {
  it('formats a Date correctly', () => {
    const date = new Date(2026, 8, 22) // Sep 22, 2026
    expect(dateKey(date)).toBe('2026-09-22')
  })

  it('formats a timestamp correctly', () => {
    const ts = new Date(2026, 0, 5).getTime()
    expect(dateKey(ts)).toBe('2026-01-05')
  })

  it('formats a date string correctly', () => {
    expect(dateKey('2026-12-31')).toBe('2026-12-31')
  })
})

describe('todayKey', () => {
  it('returns today as a key string', () => {
    const today = new Date()
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(todayKey()).toBe(expected)
  })
})

describe('formatVisitDate', () => {
  it('returns 今天 for today', () => {
    expect(formatVisitDate(todayKey())).toBe('今天')
  })

  it('returns formatted date for other days', () => {
    expect(formatVisitDate('2026-06-15')).toBe('2026年6月15日')
  })

  it('returns 今天 for undefined', () => {
    expect(formatVisitDate(undefined)).toBe('今天')
  })
})

describe('buildMonthGrid', () => {
  it('returns 42 cells', () => {
    const grid = buildMonthGrid(2026, 8, [])
    expect(grid).toHaveLength(42)
  })

  it('marks cells with footprints', () => {
    const fps: Footprint[] = [
      {
        id: '1', userId: 'u', status: 'visited', poiName: 'Test',
        visitDate: '2026-09-15', photos: ['photo.jpg'], tags: [],
        visibility: 'private', source: 'manual', clientRequestId: 'r',
        createdAt: 0, updatedAt: 0,
      },
    ]
    const grid = buildMonthGrid(2026, 8, fps)
    const cellWithFootprint = grid.find((c) => c.key === '2026-09-15')
    expect(cellWithFootprint?.footprintCount).toBe(1)
    expect(cellWithFootprint?.previewPhoto).toBe('photo.jpg')
  })

  it('starts on Monday', () => {
    const grid = buildMonthGrid(2026, 8, []) // Sep 2026
    // Sep 1, 2026 is a Tuesday, so the grid should start on Mon Aug 31
    expect(grid[0].key).toBe('2026-08-31')
  })
})

describe('daysUntil', () => {
  it('returns 0 for today', () => {
    expect(daysUntil(todayKey())).toBe(0)
  })

  it('returns positive for future', () => {
    const future = addDays(todayKey(), 30)
    expect(daysUntil(future)).toBe(30)
  })

  it('returns negative for past', () => {
    const past = addDays(todayKey(), -5)
    expect(daysUntil(past)).toBe(-5)
  })
})

describe('addDays', () => {
  it('adds days correctly', () => {
    expect(addDays('2026-01-01', 10)).toBe('2026-01-11')
  })

  it('handles month boundary', () => {
    expect(addDays('2026-01-30', 5)).toBe('2026-02-04')
  })
})
