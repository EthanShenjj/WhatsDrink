import { describe, it, expect } from 'vitest'
import {
  matchesFilter,
  computeLighting,
  groupByDate,
  sortByVisitDate,
  createDefaultFootprint,
  placeKey,
  visitsAtPlace,
  computeCityGrowth,
  buildMemoryDrops,
} from '../miniprogram/utils/footprint'
import type { Footprint, FilterState } from '../miniprogram/domain/types'

const makeFP = (overrides: Partial<Footprint> = {}): Footprint => ({
  id: 'fp1',
  userId: 'u1',
  status: 'visited',
  poiName: 'Test Place',
  photos: [],
  tags: [],
  visibility: 'private',
  source: 'manual',
  clientRequestId: 'req1',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
})

describe('matchesFilter', () => {
  it('passes with empty filter', () => {
    const fp = makeFP({ visitDate: '2026-09-22' })
    expect(matchesFilter(fp, {})).toBe(true)
  })

  it('filters by category', () => {
    const fp = makeFP({ category: 'park' })
    const filter: FilterState = { category: 'food' }
    expect(matchesFilter(fp, filter)).toBe(false)
  })

  it('filters by date range', () => {
    const fp = makeFP({ visitDate: '2026-06-15' })
    expect(matchesFilter(fp, { dateStart: '2026-01-01', dateEnd: '2026-12-31' })).toBe(true)
    expect(matchesFilter(fp, { dateStart: '2026-07-01' })).toBe(false)
  })

  it('filters by city', () => {
    const fp = makeFP({ city: '成都' })
    expect(matchesFilter(fp, { city: '成都' })).toBe(true)
    expect(matchesFilter(fp, { city: '北京' })).toBe(false)
  })

  it('excludes footprints without visitDate when date filter set', () => {
    const fp = makeFP({ visitDate: undefined })
    expect(matchesFilter(fp, { dateStart: '2026-01-01' })).toBe(false)
  })
})

describe('computeLighting', () => {
  it('returns zeros for empty list', () => {
    const stats = computeLighting([])
    expect(stats.visitedCount).toBe(0)
    expect(stats.cities).toBe(0)
    expect(stats.provinces).toBe(0)
  })

  it('counts unique provinces and cities', () => {
    const fps = [
      makeFP({ status: 'visited', province: '四川', city: '成都' }),
      makeFP({ status: 'visited', province: '四川', city: '绵阳' }),
      makeFP({ status: 'visited', province: '北京', city: '北京' }),
      makeFP({ status: 'wishlist', province: '云南', city: '大理' }),
    ]
    const stats = computeLighting(fps)
    expect(stats.visitedCount).toBe(3)
    expect(stats.wishlistCount).toBe(1)
    expect(stats.provinces).toBe(2) // 四川 + 北京
    expect(stats.cities).toBe(3) // 成都 + 绵阳 + 北京
    expect(stats.litProvinces).toContain('四川')
    expect(stats.litCities).toContain('成都')
  })

  it('counts photos', () => {
    const fps = [
      makeFP({ status: 'visited', photos: ['a.jpg', 'b.jpg'] }),
      makeFP({ status: 'visited', photos: ['c.jpg'] }),
    ]
    const stats = computeLighting(fps)
    expect(stats.photoCount).toBe(3)
  })

  it('counts repeat visits to one POI as one place', () => {
    const fps = [
      makeFP({ id: 'a', poiName: '人民公园', lat: 30.658, lng: 104.064, visitDate: '2025-09-01' }),
      makeFP({ id: 'b', poiName: '人民公园', lat: 30.658, lng: 104.064, visitDate: '2026-09-01' }),
    ]
    const stats = computeLighting(fps)
    expect(stats.visitedCount).toBe(2)
    expect(stats.places).toBe(1)
  })

  it('counts kept fulfilled wishes and legacy converted visits without double-counting', () => {
    const fps = [
      makeFP({ id: 'wish-1', status: 'fulfilled', fulfilledVisitId: 'visit-1' }),
      makeFP({ id: 'visit-1', wishId: 'wish-1', convertedFromWishlist: true }),
      makeFP({ id: 'legacy-visit', convertedFromWishlist: true }),
    ]
    expect(computeLighting(fps).fulfilledWishCount).toBe(2)
  })
})

describe('place ring and city growth', () => {
  it('uses a stable explicit place ID to group revisits', () => {
    const a = makeFP({ id: 'a', placeId: 'poi-123', poiName: '老书店', visitDate: '2025-01-01' })
    const b = makeFP({ id: 'b', placeId: 'poi-123', poiName: '老书店新名字', visitDate: '2026-01-01' })
    expect(placeKey(a)).toBe('poi-123')
    expect(visitsAtPlace([a, b], a).map((fp) => fp.id)).toEqual(['b', 'a'])
  })

  it('levels cities by unique places, not visit count', () => {
    const fps = Array.from({ length: 10 }, (_, index) => makeFP({
      id: `visit-${index}`,
      placeId: index < 2 ? 'same-place' : `place-${index}`,
      province: '四川',
      city: '成都',
      lat: 30.6,
      lng: 104.0,
    }))
    expect(computeCityGrowth(fps)[0]).toMatchObject({ city: '成都', places: 9, level: 2 })
    fps.push(makeFP({ id: 'visit-10', placeId: 'place-10', province: '四川', city: '成都' }))
    expect(computeCityGrowth(fps)[0]).toMatchObject({ places: 10, level: 3 })
  })
})

describe('memory drops', () => {
  it('prioritizes anniversaries, samples recent visits consistently and limits to three', () => {
    const fps = [
      makeFP({ id: 'anniversary', visitDate: '2024-09-23' }),
      ...Array.from({ length: 5 }, (_, index) => makeFP({ id: `recent-${index}`, visitDate: `2026-09-${String(index + 1).padStart(2, '0')}` })),
    ]
    const first = buildMemoryDrops(fps, '2026-09-23')
    expect(first).toHaveLength(3)
    expect(first[0]).toMatchObject({ id: 'anniversary', kind: 'anniversary' })
    expect(buildMemoryDrops([...fps].reverse(), '2026-09-23').map((drop) => drop.id)).toEqual(first.map((drop) => drop.id))
  })

  it('stays hidden with no eligible memories', () => {
    expect(buildMemoryDrops([makeFP({ visitDate: '2026-09-23' })], '2026-09-23')).toEqual([])
  })
})

describe('groupByDate', () => {
  it('groups footprints by visitDate', () => {
    const fps = [
      makeFP({ id: '1', visitDate: '2026-09-22' }),
      makeFP({ id: '2', visitDate: '2026-09-22' }),
      makeFP({ id: '3', visitDate: '2026-09-21' }),
    ]
    const grouped = groupByDate(fps)
    expect(grouped.get('2026-09-22')).toHaveLength(2)
    expect(grouped.get('2026-09-21')).toHaveLength(1)
  })

  it('falls back to createdAt for date key', () => {
    const fps = [makeFP({ id: '1', visitDate: undefined, createdAt: 1726924800000 })]
    const grouped = groupByDate(fps)
    expect(grouped.size).toBe(1)
  })
})

describe('sortByVisitDate', () => {
  it('sorts by date descending', () => {
    const fps = [
      makeFP({ id: '1', visitDate: '2026-01-01' }),
      makeFP({ id: '2', visitDate: '2026-06-01' }),
      makeFP({ id: '3', visitDate: '2026-03-01' }),
    ]
    const sorted = sortByVisitDate(fps)
    expect(sorted[0].id).toBe('2')
    expect(sorted[1].id).toBe('3')
    expect(sorted[2].id).toBe('1')
  })
})

describe('createDefaultFootprint', () => {
  it('creates a visited footprint with today date', () => {
    const draft = createDefaultFootprint()
    expect(draft.status).toBe('visited')
    expect(draft.visibility).toBe('private')
    expect(draft.source).toBe('manual')
    expect(draft.photos).toEqual([])
    expect(draft.visitDate).toBeTruthy()
  })

  it('allows overrides', () => {
    const draft = createDefaultFootprint({ status: 'wishlist', poiName: '故宫' })
    expect(draft.status).toBe('wishlist')
    expect(draft.poiName).toBe('故宫')
  })
})
