import { describe, expect, it } from 'vitest'
import { budgetMapItems, inMapViewport, visibleMapItems } from '../miniprogram/utils/map-viewport'
import type { Footprint } from '../miniprogram/domain/types'

const footprint = (id: string, lat: number, lng: number): Footprint => ({
  id, lat, lng, status: 'visited', poiName: id, photos: [], tags: [],
  source: 'manual', userId: 'test', clientRequestId: id, createdAt: 1, updatedAt: 1,
})

describe('map viewport marker budget', () => {
  it('keeps points near the date line and excludes distant points', () => {
    const viewport = {
      southwest: { latitude: -1, longitude: 179 },
      northeast: { latitude: 1, longitude: -179 },
    }
    expect(inMapViewport(0, 179.8, viewport)).toBe(true)
    expect(inMapViewport(0, -179.8, viewport)).toBe(true)
    expect(inMapViewport(0, 0, viewport)).toBe(false)
    expect(inMapViewport(0, 0, {
      southwest: { latitude: -1, longitude: 179.8 },
      northeast: { latitude: 1, longitude: -179.8 },
    })).toBe(false)
    expect(visibleMapItems([
      footprint('east', 0, 179.8), footprint('west', 0, -179.8), footprint('far', 0, 0),
    ], viewport).map((item) => item.id)).toEqual(['east', 'west'])
  })

  it('caps 1000 dense points while keeping every source ID reachable', () => {
    const items = Array.from({ length: 1000 }, (_, index) =>
      footprint(`p_${index}`, 30 + index * 0.00001, 120 + index * 0.00001))
    const budgeted = budgetMapItems(items, 200)
    expect(budgeted.length).toBeLessThanOrEqual(200)
    const ids = budgeted.flatMap((item) => 'footprintIds' in item ? item.footprintIds : [item.id])
    expect(new Set(ids).size).toBe(1000)
  })
})
