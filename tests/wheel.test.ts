import { describe, expect, it } from 'vitest'
import type { WheelItem } from '../miniprogram/domain/types'
import {
  brandToWheelItem,
  chooseWheelItem,
  normalizeWheelItemsToBrands,
  validateWheelItems,
  wheelItemToDraft,
} from '../miniprogram/utils/wheel'

const items: WheelItem[] = [
  { id: 'a', label: 'A' },
  {
    id: 'b',
    label: '瑞幸 · 生椰拿铁',
    brandName: '瑞幸',
    drinkName: '生椰拿铁',
    category: 'coffee',
    calorieKcal: 180,
  },
  { id: 'c', label: 'C' },
]

describe('Choice One wheel', () => {
  it('creates catalog candidates from brands without drink details', () => {
    const item = brandToWheelItem(
      { id: 'luckin', name: '瑞幸', category: 'coffee', public: true, version: 1 },
      'item-1',
    )

    expect(item).toEqual({
      id: 'item-1',
      label: '瑞幸',
      brandId: 'luckin',
      brandName: '瑞幸',
      category: 'coffee',
    })
  })

  it('shows existing structured candidates as unique brand names', () => {
    const normalized = normalizeWheelItemsToBrands([
      items[1],
      {
        ...items[1],
        id: 'b2',
        label: '瑞幸 · 标准美式',
        drinkName: '标准美式',
      },
      { id: 'custom', label: '楼下咖啡' },
    ])

    expect(normalized.map((item) => item.label)).toEqual(['瑞幸', '楼下咖啡'])
    expect(normalized[0]).toMatchObject({
      brandName: '瑞幸',
      category: 'coffee',
    })
    expect(normalized[0].drinkName).toBeUndefined()
    expect(normalized[0].calorieKcal).toBeUndefined()
  })

  it('rejects fewer than 2 and more than 20 candidates', () => {
    expect(validateWheelItems([items[0]])).toBe('至少添加 2 个候选项')
    expect(
      validateWheelItems(
        Array.from({ length: 21 }, (_, index) => ({ id: String(index), label: String(index) })),
      ),
    ).toBe('最多添加 20 个候选项')
  })

  it('maps deterministic random values to first and last candidates', () => {
    expect(chooseWheelItem(items, () => 0)).toBe(items[0])
    expect(chooseWheelItem(items, () => 0.999999)).toBe(items[2])
  })

  it('converts a structured result into a prefilled unsaved record draft', () => {
    const draft = wheelItemToDraft(items[1], 123456)
    expect(draft).toMatchObject({
      brandName: '瑞幸',
      drinkName: '生椰拿铁',
      category: 'coffee',
      calorieKcal: 180,
      calorieSource: 'estimated',
      consumedAt: 123456,
    })
    expect(draft.id).toBeUndefined()
  })

  it('prefills only the brand when a brand-only candidate wins', () => {
    const draft = wheelItemToDraft(
      { id: 'luckin', label: '瑞幸', brandName: '瑞幸', category: 'coffee' },
      123,
    )

    expect(draft.brandName).toBe('瑞幸')
    expect(draft.drinkName).toBe('')
    expect(draft.calorieKcal).toBeUndefined()
  })

  it('uses free text as the drink name without inventing a brand', () => {
    const draft = wheelItemToDraft({ id: 'x', label: '楼下咖啡' }, 123)
    expect(draft.brandName).toBe('')
    expect(draft.drinkName).toBe('楼下咖啡')
    expect(draft.calorieKcal).toBeUndefined()
  })
})
