import { describe, expect, it } from 'vitest'
import type { DrinkRecord } from '../miniprogram/domain/types'
import {
  buildMonthGrid,
  dateKey,
  getWeekDays,
  summarizeRecords,
  timestampFromDateAndTime,
} from '../miniprogram/utils/date'

const record = (id: string, calories?: number): DrinkRecord => ({
  id,
  category: 'coffee',
  brandName: '测试品牌',
  drinkName: '测试饮品',
  size: '中杯',
  temperature: '冰',
  sweetness: '标准糖',
  calorieKcal: calories,
  calorieSource: 'user',
  note: '',
  consumedAt: Date.now(),
  clientRequestId: `request-${id}`,
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

describe('date utilities', () => {
  it('builds the correct Monday-to-Sunday week around 2026-07-23', () => {
    const anchor = new Date(2026, 6, 23, 12)
    const days = getWeekDays(anchor)
    expect(days.map((day) => day.day)).toEqual([20, 21, 22, 23, 24, 25, 26])
    expect(days.map((day) => day.weekday)).toEqual(['一', '二', '三', '四', '五', '六', '日'])
    expect(days.find((day) => day.isToday)?.key).toBe('2026-07-23')
  })

  it('builds a 42-cell July 2026 month grid beginning on Monday', () => {
    const cells = buildMonthGrid(2026, 6, new Date(2026, 6, 23))
    expect(cells).toHaveLength(42)
    expect(cells[0].key).toBe('2026-06-29')
    expect(cells[2].key).toBe('2026-07-01')
    expect(cells.find((cell) => cell.isToday)?.key).toBe('2026-07-23')
  })

  it('sums only known calories and reports missing values', () => {
    expect(summarizeRecords([record('a', 180), record('b'), record('c', 106)])).toEqual({
      count: 3,
      knownCalories: 286,
      unknownCaloriesCount: 1,
    })
  })

  it('combines local date and time without UTC drift', () => {
    const timestamp = timestampFromDateAndTime('2026-07-23', '09:10')
    expect(dateKey(timestamp)).toBe('2026-07-23')
    expect(new Date(timestamp).getHours()).toBe(9)
    expect(new Date(timestamp).getMinutes()).toBe(10)
  })
})
