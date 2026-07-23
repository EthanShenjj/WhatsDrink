import { describe, expect, it } from 'vitest'

const { sanitizeRecord } = require('../cloudfunctions/recordMutation/validation.js')
const { sanitizeWheelItems } = require('../cloudfunctions/wheelMutation/validation.js')

describe('cloud mutation validation', () => {
  it('derives record ownership from trusted context and trims untrusted text', () => {
    const result = sanitizeRecord(
      {
        category: 'coffee',
        brandName: '  瑞幸  ',
        drinkName: ' 生椰拿铁 ',
        size: '中杯',
        temperature: '冰',
        sweetness: '标准糖',
        calorieKcal: 180,
        calorieSource: 'estimated',
        consumedAt: 123,
        note: 'x'.repeat(260),
      },
      'trusted-openid',
      undefined,
      456,
    )
    expect(result._openid).toBe('trusted-openid')
    expect(result.brandName).toBe('瑞幸')
    expect(result.drinkName).toBe('生椰拿铁')
    expect(result.note).toHaveLength(200)
    expect(result.createdAt).toBe(456)
  })

  it('rejects invalid calories, ratings and missing login identity', () => {
    const base = {
      category: 'coffee',
      drinkName: '拿铁',
      consumedAt: 123,
    }
    expect(() => sanitizeRecord({ ...base, calorieKcal: -1 }, 'openid')).toThrow('数值字段不合法')
    expect(() => sanitizeRecord({ ...base, rating: 6 }, 'openid')).toThrow('数值字段不合法')
    expect(() => sanitizeRecord(base, '')).toThrow('登录状态无效')
  })

  it('enforces 2–20 sanitized wheel candidates', () => {
    expect(() => sanitizeWheelItems([{ id: 'a', label: 'A' }])).toThrow(
      '转盘候选项必须为 2–20 个',
    )
    const result = sanitizeWheelItems([
      { id: 'a', label: ' A ' },
      { id: 'b', label: ' B ', brandId: 'brand-b', calorieKcal: 180 },
    ])
    expect(result.map((item: { label: string }) => item.label)).toEqual(['A', 'B'])
    expect(result[1].brandId).toBe('brand-b')
  })
})
