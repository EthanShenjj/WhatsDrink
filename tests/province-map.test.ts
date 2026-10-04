import { describe, expect, it } from 'vitest'
import type { Footprint } from '../miniprogram/domain/types'
import {
  buildProvincePolygons,
  normalizeProvince,
  provinceAt,
  provinceOverviews,
  resolveProvince,
} from '../miniprogram/utils/province-map'

const footprint = (id: string, overrides: Partial<Footprint> = {}): Footprint => ({
  id,
  userId: 'u1',
  status: 'visited',
  poiName: '一处地方',
  photos: [],
  tags: [],
  source: 'manual',
  clientRequestId: id,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
})

describe('province lighting layer', () => {
  it('shows lit city names while keeping city stamps out of place memories and visits', () => {
    const view = provinceOverviews([
      footprint('city', { recordLevel: 'city', province: '四川', city: '成都', poiName: '成都', visitDate: undefined }),
      footprint('place', { province: '四川', city: '成都', poiName: '人民公园', visitDate: '2026-09-01' }),
      footprint('other', { recordLevel: 'city', province: '四川', city: '绵阳', poiName: '绵阳', visitDate: undefined }),
    ])[0]
    expect(view).toMatchObject({ cities: 2, places: 1, visits: 1 })
    expect(view.cityNames).toEqual(['成都', '绵阳'])
    expect(view.memories.map((item) => item.id)).toEqual(['place'])
  })
  it('matches short and full province names', () => {
    expect(normalizeProvince('新疆维吾尔自治区')).toBe('新疆')
    expect(resolveProvince('四川')).toBe('四川省')
    expect(resolveProvince('香港')).toBe('香港特别行政区')
  })

  it('fills only visited provinces, while selected unvisited regions get a faint outline', () => {
    const filled = buildProvincePolygons(['四川'])
    const selected = buildProvincePolygons(['四川'], '云南')
    expect(filled.length).toBeGreaterThan(0)
    expect(selected.length).toBeGreaterThan(filled.length)
    expect(selected.some((polygon) => polygon.fillColor === '#5B6CFF22')).toBe(true)
    expect(buildProvincePolygons([])).toHaveLength(0)
  })

  it('finds the province tapped on the map', () => {
    expect(provinceAt(30.5728, 104.0668)).toBe('四川省')
    expect(provinceAt(0, 0)).toBeUndefined()
  })

  it('groups visits without counting wishlisted places and merges name variants', () => {
    const views = provinceOverviews([
      footprint('a', { province: '四川', city: '成都', poiName: '公园', visitDate: '2026-09-01' }),
      footprint('b', { province: '四川省', city: '成都', poiName: '书店', visitDate: '2026-09-02' }),
      footprint('d', { lat: 30.5728, lng: 104.0668, city: '成都', poiName: '老街', visitDate: '2026-09-03' }),
      footprint('c', { province: '云南', status: 'wishlist' }),
    ])
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({ name: '四川省', places: 3, visits: 3, cities: 1 })
    expect(views[0].memories.map((item) => item.id)).toEqual(['d', 'b', 'a'])
  })
})
