import { describe, expect, it } from 'vitest'
import {
  PAYMENT_PRODUCTS,
  extendPlusUntil,
  formatPrice,
  getPaymentProduct,
  hasTimeCapsuleCapacity,
  isMembershipExpiringSoon,
  membershipDaysLeft,
} from '../miniprogram/utils/payment'

const DAY = 86_400_000

describe('拾光+ 商品与权益', () => {
  it('offers the two Plus durations and the Pro annual tier', () => {
    expect(PAYMENT_PRODUCTS.map((product) => product.id)).toEqual([
      'plus_31d_v1',
      'plus_372d_v1',
      'pro_372d_v1',
    ])
    expect(getPaymentProduct('plus_372d_v1')?.priceFen).toBe(4900)
    expect(getPaymentProduct('pro_372d_v1')).toMatchObject({
      tier: 'pro',
      priceFen: 9900,
      days: 372,
    })
  })

  it('starts a new entitlement from fulfillment time', () => {
    const fulfilledAt = Date.UTC(2026, 8, 26)

    expect(extendPlusUntil(undefined, 31, fulfilledAt)).toBe(fulfilledAt + 31 * DAY)
  })

  it('preserves remaining trial or paid time when a user buys again', () => {
    const fulfilledAt = Date.UTC(2026, 8, 26)
    const currentUntil = fulfilledAt + 5 * DAY

    expect(extendPlusUntil(currentUntil, 31, fulfilledAt)).toBe(currentUntil + 31 * DAY)
  })

  it('formats integer and decimal yuan prices for the purchase page', () => {
    expect(formatPrice(600)).toBe('6')
    expect(formatPrice(4900)).toBe('49')
    expect(formatPrice(990)).toBe('9.9')
  })

  it('keeps three capsules free and removes the limit while Plus is active', () => {
    const now = Date.UTC(2026, 8, 26)

    expect(hasTimeCapsuleCapacity(2, undefined, now)).toBe(true)
    expect(hasTimeCapsuleCapacity(3, undefined, now)).toBe(false)
    expect(hasTimeCapsuleCapacity(3, { plusUntil: now + DAY }, now)).toBe(true)
  })

  it('counts remaining membership days up to the expiry moment', () => {
    const now = Date.UTC(2026, 8, 26)

    expect(membershipDaysLeft(undefined, now)).toBe(0)
    expect(membershipDaysLeft(now - 1, now)).toBe(0)
    expect(membershipDaysLeft(now + 31 * DAY, now)).toBe(31)
    // 未满一天也按 1 天展示，避免到期当天显示“剩余 0 天”
    expect(membershipDaysLeft(now + 3600_000, now)).toBe(1)
  })

  it('flags memberships expiring within the renewal window only', () => {
    const now = Date.UTC(2026, 8, 26)

    expect(isMembershipExpiringSoon(now + 6 * DAY, now)).toBe(true)
    expect(isMembershipExpiringSoon(now + 7 * DAY, now)).toBe(true)
    expect(isMembershipExpiringSoon(now + 8 * DAY, now)).toBe(false)
    expect(isMembershipExpiringSoon(now - DAY, now)).toBe(false)
    expect(isMembershipExpiringSoon(undefined, now)).toBe(false)
  })
})
