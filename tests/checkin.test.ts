import { describe, expect, it } from 'vitest'
import type { Footprint } from '../miniprogram/domain/types'
import { buildCheckinRoute, findNearbyCheckinCandidate } from '../miniprogram/utils/checkin'

const makeFootprint = (
  id: string,
  status: Footprint['status'],
  lat?: number,
  lng?: number,
): Footprint => ({
  id,
  userId: 'test',
  status,
  poiName: id,
  lat,
  lng,
  photos: [],
  tags: [],
  source: 'manual',
  clientRequestId: `req-${id}`,
  createdAt: 1,
  updatedAt: 1,
})

describe('findNearbyCheckinCandidate', () => {
  it('returns the nearest saved place within one kilometre', () => {
    const candidate = findNearbyCheckinCandidate(31.2304, 121.4737, [
      makeFootprint('far', 'visited', 31.239, 121.4737),
      makeFootprint('near', 'visited', 31.231, 121.4737),
    ])

    expect(candidate?.footprint.id).toBe('near')
    expect(candidate?.action).toBe('revisit')
    expect(candidate?.distance).toBeLessThan(100)
  })
})

describe('buildCheckinRoute', () => {
  it('turns a nearby wishlist place into an arrival check-in flow', () => {
    const footprint = makeFootprint('wish-1', 'wishlist', 31.2305, 121.4737)

    expect(buildCheckinRoute({
      footprint,
      distance: 12.4,
      action: 'fulfill',
    })).toBe('/pages/footprint-form/index?id=wish-1&convert=1&checkin=1&distance=12')
  })
})
