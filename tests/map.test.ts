import { describe, it, expect } from 'vitest'
import { clusterFootprints, fitBounds, haversine } from '../miniprogram/utils/map'
import type { Footprint } from '../miniprogram/domain/types'

const makeFootprint = (lat: number, lng: number, id?: string): Footprint => ({
  id: id || `fp_${lat}_${lng}`,
  userId: 'test',
  status: 'visited',
  poiName: 'Test',
  lat,
  lng,
  photos: [],
  tags: [],
  visibility: 'private',
  source: 'manual',
  clientRequestId: 'req',
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

describe('haversine', () => {
  it('returns 0 for same point', () => {
    expect(haversine(30, 104, 30, 104)).toBe(0)
  })

  it('returns positive distance for different points', () => {
    const dist = haversine(30.01, 104.01, 30.02, 104.02)
    expect(dist).toBeGreaterThan(1000)
    expect(dist).toBeLessThan(2000)
  })
})

describe('clusterFootprints', () => {
  it('returns single footprint as-is', () => {
    const fps = [makeFootprint(30, 104)]
    const result = clusterFootprints(fps, 10)
    expect(result).toHaveLength(1)
  })

  it('clusters nearby footprints at low zoom', () => {
    const fps = [
      makeFootprint(30.001, 104.001, 'a'),
      makeFootprint(30.002, 104.002, 'b'),
      makeFootprint(30.003, 104.003, 'c'),
      makeFootprint(30.004, 104.004, 'd'),
    ]
    const result = clusterFootprints(fps, 3)
    expect(result.some((r) => 'count' in r && r.count >= 4)).toBe(true)
  })

  it('does not cluster spread-out footprints', () => {
    const fps = [
      makeFootprint(30, 104, 'a'),
      makeFootprint(35, 110, 'b'),
    ]
    const result = clusterFootprints(fps, 10)
    expect(result).toHaveLength(2)
  })
})

describe('fitBounds', () => {
  it('returns default for empty list', () => {
    const result = fitBounds([])
    expect(result.scale).toBe(4)
  })

  it('returns single point with high zoom', () => {
    const result = fitBounds([makeFootprint(30, 104)])
    expect(result.scale).toBe(16)
    expect(result.latitude).toBe(30)
  })

  it('calculates center and scale for spread points', () => {
    const result = fitBounds([
      makeFootprint(20, 100),
      makeFootprint(40, 110),
    ])
    expect(result.latitude).toBeCloseTo(30, 0)
    expect(result.longitude).toBeCloseTo(105, 0)
  })

  it('centers overseas visits across the date line instead of the wrong side of the world', () => {
    const result = fitBounds([
      makeFootprint(35.7, 139.7, 'tokyo'),
      makeFootprint(37.8, -122.4, 'san-francisco'),
    ])
    expect(result.longitude).toBeLessThan(-150)
    expect(result.scale).toBe(3)
  })
})
