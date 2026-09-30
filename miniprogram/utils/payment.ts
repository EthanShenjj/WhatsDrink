import type { GrowthPreferences, PaymentProduct, PaymentProductId } from '../domain/types'

const DAY = 86_400_000

export const PAYMENT_PRODUCTS: readonly PaymentProduct[] = [
  {
    id: 'plus_31d_v1',
    tier: 'plus',
    name: '拾光+ 31 天',
    shortName: '31 天卡',
    description: '轻松体验完整回顾与专属表达',
    priceFen: 600,
    days: 31,
  },
  {
    id: 'plus_372d_v1',
    tier: 'plus',
    name: '拾光+ 372 天',
    shortName: '372 天卡',
    description: '把一整年的足迹，留成完整的回响',
    badge: '推荐',
    priceFen: 4900,
    days: 372,
  },
  {
    id: 'pro_372d_v1',
    tier: 'pro',
    name: '拾光 Pro 年卡',
    shortName: 'Pro 年卡',
    description: '包含拾光+，优先体验未来新功能与 AI 能力',
    badge: 'PRO',
    priceFen: 9900,
    days: 372,
  },
] as const

export const getPaymentProduct = (id: string): PaymentProduct | undefined =>
  PAYMENT_PRODUCTS.find((product) => product.id === id)

export const isPaymentProductId = (id: string): id is PaymentProductId =>
  Boolean(getPaymentProduct(id))

export const extendPlusUntil = (
  currentUntil: number | undefined,
  days: number,
  fulfilledAt = Date.now(),
): number => Math.max(currentUntil || 0, fulfilledAt) + days * DAY

export const formatPrice = (priceFen: number): string => {
  const yuan = priceFen / 100
  return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2).replace(/0+$/, '')
}

export const FREE_TIME_CAPSULE_LIMIT = 3

export const hasTimeCapsuleCapacity = (
  capsuleCount: number,
  growth?: GrowthPreferences,
  now = Date.now(),
): boolean => capsuleCount < FREE_TIME_CAPSULE_LIMIT || Boolean(growth?.plusUntil && growth.plusUntil > now)

// 会员为一次性购买，不会自动续费；到期状态用于购买页的续费提示与到期提醒开关。
export const MEMBERSHIP_EXPIRING_SOON_DAYS = 7

export const membershipDaysLeft = (until: number | undefined, now = Date.now()): number =>
  until && until > now ? Math.max(1, Math.ceil((until - now) / DAY)) : 0

export const isMembershipExpiringSoon = (until: number | undefined, now = Date.now()): boolean => {
  const daysLeft = membershipDaysLeft(until, now)
  return daysLeft > 0 && daysLeft <= MEMBERSHIP_EXPIRING_SOON_DAYS
}
