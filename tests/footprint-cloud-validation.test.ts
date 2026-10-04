import { describe, expect, it } from 'vitest'

const { sanitizeFootprint, toFootprintSummary } = require('../cloudfunctions/footprintMutation/validation.js') as {
  sanitizeFootprint: (
    input: Record<string, unknown>,
    openid: string,
    existing?: Record<string, unknown>,
    now?: number,
  ) => Record<string, unknown>
  toFootprintSummary: (input: Record<string, unknown>) => Record<string, unknown>
}

describe('cloud footprint validation', () => {
  it('keeps undated city stamps undated and rejects precise or private city content', () => {
    const city = { recordLevel: 'city', status: 'visited', poiName: '成都', country: '中国', province: '四川', city: '成都', photos: [] }
    const saved = sanitizeFootprint(city, 'owner')
    expect(saved).toMatchObject({ recordLevel: 'city', province: '四川', city: '成都' })
    expect(saved.visitDate).toBeUndefined()
    expect(saved.lat).toBeUndefined()
    expect(() => sanitizeFootprint({ ...city, lat: 30, lng: 104 }, 'owner')).toThrow('具体位置')
    expect(() => sanitizeFootprint({ ...city, note: '私人笔记' }, 'owner')).toThrow('私人内容')
    expect(() => sanitizeFootprint({ ...city, province: '' }, 'owner')).toThrow('省份和城市')
  })
  it('accepts a place-only visit without location permission', () => {
    const saved = sanitizeFootprint({ poiName: '街角老店', photos: [], tags: [] }, 'owner', undefined, 1_798_000_000_000)
    expect(saved.status).toBe('visited')
    expect(saved.poiName).toBe('街角老店')
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

  it('validates thumbnail ownership and returns lightweight list summaries', () => {
    const saved = sanitizeFootprint({
      poiName: '公园',
      photos: [
        'cloud://env/footprint-photos/owner/full-1.jpg',
        'cloud://env/footprint-photos/owner/full-2.jpg',
      ],
      photoThumbs: [
        'cloud://env/footprint-photos/owner/thumb-1.jpg',
        'cloud://env/footprint-photos/owner/thumb-2.jpg',
      ],
    }, 'owner')
    const summary = toFootprintSummary(saved)

    expect(summary.photos).toEqual([])
    expect(summary.photoThumbs).toEqual(['cloud://env/footprint-photos/owner/thumb-1.jpg'])
    expect(summary.photoCount).toBe(2)
    expect(summary.isSummary).toBe(true)
    expect(() => sanitizeFootprint({
      poiName: '公园',
      photos: ['cloud://env/footprint-photos/owner/full.jpg'],
      photoThumbs: ['cloud://env/footprint-photos/other/thumb.jpg'],
    }, 'owner')).toThrow('缩略图')
    expect(() => sanitizeFootprint({
      poiName: '公园',
      photos: [
        'cloud://env/footprint-photos/owner/full-1.jpg',
        'cloud://env/footprint-photos/owner/full-2.jpg',
      ],
      photoThumbs: ['cloud://env/footprint-photos/owner/thumb-1.jpg'],
    }, 'owner')).toThrow('数量不一致')
  })

  it('keeps one original preview for legacy records without thumbnails', () => {
    const summary = toFootprintSummary({ photos: ['legacy-1.jpg', 'legacy-2.jpg'] })
    expect(summary.photos).toEqual(['legacy-1.jpg'])
    expect(summary.photoCount).toBe(2)
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
