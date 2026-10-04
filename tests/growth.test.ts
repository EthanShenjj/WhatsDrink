import { describe, expect, it } from 'vitest'
import type { Footprint, UserProfile } from '../miniprogram/domain/types'
import {
  computeGrowthOverview,
  computeGrowthSnapshot,
  hasDistantPairDeferred,
} from '../miniprogram/utils/growth'

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
  source: 'manual',
  clientRequestId: `request-${id}`,
  createdAt: at(visitDate),
  updatedAt: at(visitDate),
  ...overrides,
})

const makeProfile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  id: 'user',
  nickname: '',
  avatarUrl: '',
  createdAt: at('2025-01-01'),
  updatedAt: at('2026-09-24'),
  ...overrides,
})

describe('Lumi 成长', () => {
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

  it('gives every hidden state a distinct mascot color and pose', () => {
    const snapshot = computeGrowthSnapshot([], makeProfile(), at('2026-09-24'))
    const states = snapshot.hiddenStates

    expect(states).toHaveLength(6)
    const combos = states.map((item) => `${item.mascotState}|${item.expression}`)
    expect(new Set(combos).size).toBe(combos.length)
    expect(new Set(states.map((item) => item.mascotState)).size).toBe(states.length)
  })

  it('defaults to automatic color and keeps an earned fixed color without Plus', () => {
    const now = at('2026-09-24')
    const visits = [
      makeFootprint('1', '2026-09-10'),
      makeFootprint('2', '2026-09-11'),
      makeFootprint('3', '2026-09-12'),
    ]
    const automatic = computeGrowthSnapshot(visits, makeProfile(), now)
    const fixedProfile = makeProfile({ growth: { lockedColorId: 'explore' } })
    const fixed = computeGrowthSnapshot(visits, fixedProfile, now)
    const overview = computeGrowthOverview(visits, fixedProfile, now)
    const unavailable = computeGrowthSnapshot(visits, makeProfile({
      growth: { lockedColorId: 'dawn' },
    }), now)

    expect(automatic.colorMode).toBe('auto')
    expect(automatic.activeColorId).toBe(automatic.weeklyColorId)
    expect(fixed.colorMode).toBe('fixed')
    expect(fixed.activeColorId).toBe('explore')
    expect(fixed.displayTitle).toBe('固定展示 · 探索橙粉')
    expect(overview.activeColorId).toBe('explore')
    expect(overview.displayTitle).toBe(fixed.displayTitle)
    expect(unavailable.colorMode).toBe('auto')
    expect(unavailable.activeColorId).toBe(unavailable.weeklyColorId)
  })

  it('reports an active Pro year separately while keeping Plus benefits active', () => {
    const now = at('2026-09-24')
    const snapshot = computeGrowthSnapshot([], makeProfile({
      growth: {
        plusUntil: now + 372 * 86_400_000,
        proUntil: now + 372 * 86_400_000,
      },
    }), now)

    expect(snapshot.isPlus).toBe(true)
    expect(snapshot.isPro).toBe(true)
    expect(snapshot.proDaysLeft).toBe(372)
  })

  it('builds a lightweight overview for navigation surfaces', () => {
    const overview = computeGrowthOverview([
      makeFootprint('1', '2026-09-20'),
      makeFootprint('2', '2026-09-21'),
      makeFootprint('3', '2026-09-22'),
    ], makeProfile(), at('2026-09-24'))

    expect(overview.weeklyColorId).toBe('discover')
    expect(overview.nextGoalTarget).toBeGreaterThan(0)
    expect('hiddenStates' in overview).toBe(false)
  })

  it('checks distant locations without blocking one long synchronous scan', async () => {
    const visits = [
      makeFootprint('chengdu', '2026-09-20', { lat: 30.5728, lng: 104.0668 }),
      makeFootprint('shanghai', '2026-09-21', { lat: 31.2304, lng: 121.4737 }),
    ]

    await expect(hasDistantPairDeferred(visits, 1000, 1)).resolves.toBe(true)
  })
})
