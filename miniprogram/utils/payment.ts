import type { GrowthPreferences, PaymentProduct, PaymentProductId } from '../domain/types'

const DAY = 86_400_000

export const PAYMENT_PRODUCTS: readonly PaymentProduct[] = [
  {
    id: 'plus_31d_v1',
    name: '拾光+ 31 天',
    shortName: '31 天卡',
    description: '轻松体验完整回顾与专属表达',
    priceFen: 600,
    days: 31,
  },
  {
    id: 'plus_372d_v1',
    name: '拾光+ 372 天',
    shortName: '372 天卡',
    description: '把一整年的足迹，留成完整的回响',
    badge: '推荐',
    priceFen: 4900,
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
