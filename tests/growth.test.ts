import { describe, expect, it } from 'vitest'
import type { Footprint, UserProfile } from '../miniprogram/domain/types'
import { computeGrowthSnapshot } from '../miniprogram/utils/growth'

const at = (value: string): number => new Date(`${value}T12:00:00`).getTime()

const makeFootprint = (id: string, visitDate: string, overrides: Partial<Footprint> = {}): Footprint => ({
  id,
  userId: 'user',
  status: 'visited',
  poiName: `地点 ${id}`,
  placeId: `place-${id}`,
  visitDate,
  city: '成都',
  category: 'park',
  photos: [],
  tags: [],
  visibility: 'private',
  source: 'manual',
  clientRequestId: `request-${id}`,
  createdAt: at(visitDate),
  updatedAt: at(visitDate),
  ...overrides,
})

const makeProfile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  id: 'user',
  nickname: '拾光者',
  avatarUrl: '',
  createdAt: at('2025-01-01'),
  updatedAt: at('2026-09-24'),
  ...overrides,
})

describe('小拾成长计划', () => {
  it('uses recent real-life records to create an exploration state and goal progress', () => {
    const now = at('2026-09-24')
    const snapshot = computeGrowthSnapshot([
      makeFootprint('0', '2026-08-01'),
      makeFootprint('1', '2026-09-19'),
      makeFootprint('2', '2026-09-20'),
      makeFootprint('3', '2026-09-23'),
    ], makeProfile(), now)

    expect(snapshot.weeklyColorId).toBe('explore')
    expect(snapshot.colors.find((color) => color.id === 'explore')?.unlocked).toBe(true)
    expect(snapshot.shards).toBe(7)
  })

  it('prioritizes a fulfilled wish as the weekly highlight state', () => {
    const now = at('2026-09-24')
    const snapshot = computeGrowthSnapshot([
      makeFootprint('visit', '2026-09-23', { wishId: 'wish', convertedFromWishlist: true }),
      makeFootprint('wish', '2026-09-01', {
        status: 'fulfilled',
        fulfilledAt: at('2026-09-23'),
        fulfilledVisitId: 'visit',
      }),
    ], makeProfile(), now)

    expect(snapshot.weeklyColorId).toBe('highlight')
    expect(snapshot.fulfilledCount).toBe(1)
  })

  it('unlocks dawn after returning to the same place at least 180 days later', () => {
    const snapshot = computeGrowthSnapshot([
      makeFootprint('first', '2026-01-01', { placeId: 'old-cafe' }),
      makeFootprint('return', '2026-08-01', { placeId: 'old-cafe' }),
    ], makeProfile(), at('2026-09-24'))

    expect(snapshot.hiddenStates.find((item) => item.id === 'dawn')?.unlocked).toBe(true)
    expect(snapshot.colors.find((item) => item.id === 'dawn')?.unlocked).toBe(true)
  })

  it('only applies a locked color while the Plus trial is active', () => {
    const now = at('2026-09-24')
    const visits = [
      makeFootprint('1', '2026-09-10'),
      makeFootprint('2', '2026-09-11'),
      makeFootprint('3', '2026-09-12'),
    ]
    const active = computeGrowthSnapshot(visits, makeProfile({
      growth: { lockedColorId: 'explore', plusUntil: now + 86_400_000 },
    }), now)
    const expired = computeGrowthSnapshot(visits, makeProfile({
      growth: { lockedColorId: 'explore', plusUntil: now - 1 },
    }), now)

    expect(active.activeColorId).toBe('explore')
    expect(expired.activeColorId).toBe(expired.weeklyColorId)
  })
})
