import { describe, expect, it } from 'vitest'

const { sanitizeFootprint } = require('../cloudfunctions/footprintMutation/validation.js') as {
  sanitizeFootprint: (
    input: Record<string, unknown>,
    openid: string,
    existing?: Record<string, unknown>,
    now?: number,
  ) => Record<string, unknown>
}

describe('cloud footprint validation', () => {
  it('accepts a private place-only visit without location permission', () => {
    const saved = sanitizeFootprint({ poiName: '街角老店', photos: [], tags: [] }, 'owner', undefined, 1_798_000_000_000)
    expect(saved.status).toBe('visited')
    expect(saved.poiName).toBe('街角老店')
    expect(saved.visibility).toBe('private')
    expect(saved.lat).toBeUndefined()
    expect(saved.lng).toBeUndefined()
    expect(saved.visitDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('rejects partial coordinates and photos from another account', () => {
    expect(() => sanitizeFootprint({ poiName: '公园', lat: 30 }, 'owner')).toThrow()
    expect(() => sanitizeFootprint({
      poiName: '公园',
      photos: ['cloud://env/footprint-photos/other/photo.jpg'],
    }, 'owner')).toThrow()
  })

  it('keeps the original wishlist date and links the fulfilled wish to a separate visit', () => {
    const existing = {
      status: 'wishlist',
      createdAt: 1_700_000_000_000,
      wishlistCreatedAt: 1_700_000_000_000,
      clientRequestId: 'req_original',
    }
    const wish = sanitizeFootprint({
      poiName: '故宫',
      status: 'fulfilled',
      fulfilledAt: 1_800_000_000_000,
      fulfilledVisitId: 'visit-1',
    }, 'owner', existing, 1_800_000_000_000)
    const visit = sanitizeFootprint({
      poiName: '故宫',
      status: 'visited',
      wishId: 'wish-1',
      wishlistCreatedAt: existing.createdAt,
      visitDate: '2026-09-23',
    }, 'owner', undefined, 1_800_000_000_000)
    expect(wish.status).toBe('fulfilled')
    expect(wish.fulfilledVisitId).toBe('visit-1')
    expect(wish.wishlistCreatedAt).toBe(existing.createdAt)
    expect(wish.createdAt).toBe(existing.createdAt)
    expect(visit.wishId).toBe('wish-1')
    expect(visit.convertedFromWishlist).toBe(true)
    expect(visit.createdAt).toBe(1_800_000_000_000)
  })

  it('requires a real visit link for a fulfilled wish', () => {
    expect(() => sanitizeFootprint({ poiName: '故宫', status: 'fulfilled' }, 'owner')).toThrow('关联到访记录')
  })

  it('can detach a visit when its fulfilled wish is deleted', () => {
    const existing = {
      status: 'visited',
      createdAt: 1_800_000_000_000,
      convertedFromWishlist: true,
      wishId: 'wish-1',
      wishlistCreatedAt: 1_700_000_000_000,
    }
    const visit = sanitizeFootprint({
      poiName: '故宫',
      status: 'visited',
      convertedFromWishlist: false,
      wishId: undefined,
    }, 'owner', existing, 1_800_000_000_001)
    expect(visit.wishId).toBeUndefined()
    expect(visit.convertedFromWishlist).toBeUndefined()
    expect(visit.wishlistCreatedAt).toBeUndefined()
  })
})
