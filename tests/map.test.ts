import { describe, it, expect } from 'vitest'
import { clusterFootprints, fitBounds, footprintsForMapMode, hasMapCoordinates, haversine, markerPhotoForZoom } from '../miniprogram/utils/map'
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

describe('markerPhotoForZoom', () => {
  it('uses the footprint photo for close map views', () => {
    expect(markerPhotoForZoom({ photos: ['cloud://photo.jpg'] }, 12)).toBe('cloud://photo.jpg')
  })

  it('keeps distant map views on lightweight pins', () => {
    expect(markerPhotoForZoom({ photos: ['cloud://photo.jpg'] }, 9)).toBe('')
    expect(markerPhotoForZoom({ photos: [] }, 16)).toBe('')
  })
})

describe('hasMapCoordinates', () => {
  it('accepts valid coordinates including zero', () => {
    expect(hasMapCoordinates({ lat: 0, lng: 0 })).toBe(true)
    expect(hasMapCoordinates({ lat: 31.2304, lng: 121.4737 })).toBe(true)
  })

  it('rejects missing or non-finite coordinates', () => {
    expect(hasMapCoordinates({ lat: 31.2304 })).toBe(false)
    expect(hasMapCoordinates({ lat: Number.NaN, lng: 121.4737 })).toBe(false)
  })
})

describe('footprintsForMapMode', () => {
  it('keeps visited footprints visible on the lighting map', () => {
    const visited = { ...makeFootprint(31.2, 121.4, 'visited'), photos: ['cloud://photo.jpg'] }
    const wishlist = { ...makeFootprint(31.3, 121.5, 'wishlist'), status: 'wishlist' as const }

    expect(footprintsForMapMode([visited, wishlist], 'lighting').map((item) => item.id))
      .toEqual(['visited'])
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

  it('keeps distant coastal cities separate at wide zoom and anchors the local badge on a visit', () => {
    const footprints = [
      makeFootprint(31.89815, 121.17393, 'nantong-a'),
      makeFootprint(31.89296, 121.17055, 'nantong-b'),
      makeFootprint(31.87297, 121.17919, 'nantong-c'),
      makeFootprint(31.86935, 121.18214, 'nantong-d'),
      makeFootprint(31.23247, 121.48700, 'shanghai-a'),
      makeFootprint(31.23162, 121.48461, 'shanghai-b'),
      makeFootprint(31.23040, 121.47370, 'shanghai-c'),
    ]
    const result = clusterFootprints(footprints, 4)
    const cluster = result.find((item) => 'footprintIds' in item)
    expect(cluster).toBeDefined()
    expect(cluster!.count).toBe(4)
    expect(cluster!.footprintIds).toEqual([
      'nantong-a', 'nantong-b', 'nantong-c', 'nantong-d',
    ])
    expect(footprints.some((fp) => fp.lat === cluster!.latitude && fp.lng === cluster!.longitude)).toBe(true)
    expect(cluster!.latitude).toBeGreaterThan(31.8)
    expect(result.filter((item) => !('footprintIds' in item)).map((item) => item.id)).toEqual([
      'shanghai-a', 'shanghai-b', 'shanghai-c',
    ])
    expect(clusterFootprints(footprints, 12).some((item) => 'count' in item && item.count === 7)).toBe(false)
  })

  it('does not cluster spread-out footprints', () => {
    const fps = [
      makeFootprint(30, 104, 'a'),
      makeFootprint(35, 110, 'b'),
    ]
    const result = clusterFootprints(fps, 10)
    expect(result).toHaveLength(2)
  })

  it('collapses co-located footprints into one cluster', () => {
    const fps = Array.from({ length: 50 }, (_, i) => makeFootprint(30, 104, `same_${i}`))
    const result = clusterFootprints(fps, 4)
    const clusters = result.filter((r) => 'count' in r)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].count).toBe(50)
    expect(clusters[0].footprintIds).toHaveLength(50)
  })

  it('keeps every footprint reachable exactly once', () => {
    // 稠密 + 稀疏混合：聚合展开与独立点合起来必须不重不漏
    const dense = Array.from({ length: 20 }, (_, i) =>
      makeFootprint(30 + i * 0.0005, 104 + i * 0.0005, `dense_${i}`))
    const sparse = [
      makeFootprint(31, 106, 'far_a'),
      makeFootprint(32, 107, 'far_b'),
    ]
    const result = clusterFootprints([...dense, ...sparse], 6)
    const seen: string[] = []
    for (const item of result) {
      if ('footprintIds' in item) seen.push(...item.footprintIds)
      else seen.push(item.id)
    }
    expect(seen).toHaveLength(dense.length + sparse.length)
    expect(new Set(seen).size).toBe(dense.length + sparse.length)
  })

  it('does not merge points across the antimeridian', () => {
    // ±180° 经线两侧的点在像素坐标中相距极远，不应被聚合
    const fps = [
      makeFootprint(30, 179.999, 'west'),
      makeFootprint(30, -179.999, 'east'),
      makeFootprint(30.001, 179.999, 'west2'),
      makeFootprint(30.001, -179.999, 'east2'),
    ]
    const result = clusterFootprints(fps, 10)
    expect(result.every((item) => !('footprintIds' in item))).toBe(true)
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

  it('leaves room to show coastal visits that are roughly 70 km apart', () => {
    const result = fitBounds([
      makeFootprint(31.89815, 121.17393, 'nantong'),
      makeFootprint(31.23040, 121.47370, 'shanghai'),
    ])
    expect(result.scale).toBe(9)
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
