import type {
  GrowthPreferences,
  MembershipBenefit,
  MembershipLevelView,
  PaymentProduct,
  PaymentProductId,
} from '../domain/types'

const DAY = 86_400_000

export const PAYMENT_PRODUCTS: readonly PaymentProduct[] = [
  {
    id: 'plus_31d_v1',
    tier: 'plus',
    name: 'Plus 31 天',
    shortName: 'Plus 31 天',
    description: '历史月份回顾、不限时光胶囊与 Lumi 主题',
    priceFen: 600,
    days: 31,
  },
  {
    id: 'plus_372d_v1',
    tier: 'plus',
    name: 'Plus 372 天',
    shortName: 'Plus 372 天',
    description: '与 31 天卡权益相同，有效期更长',
    badge: '推荐',
    priceFen: 4900,
    days: 372,
  },
  {
    id: 'pro_372d_v1',
    tier: 'pro',
    name: 'Pro 年卡',
    shortName: 'Pro 年卡',
    description: '年度时光回顾，以及全部 Plus 权益',
    badge: 'PRO',
    priceFen: 9900,
    days: 372,
  },
] as const

export const MEMBERSHIP_BENEFITS: readonly MembershipBenefit[] = [
  {
    key: 'core',
    name: '基础记录与本月回顾',
    description: '足迹、地图、想去清单和本月记录回顾',
    free: '可用',
    plus: '可用',
    pro: '可用',
  },
  {
    key: 'capsules',
    name: '时光胶囊',
    description: '在“时光”页保存给未来的文字、照片或足迹',
    free: '最多 3 个',
    plus: '不限数量',
    pro: '不限数量',
  },
  {
    key: 'theme',
    name: 'Lumi 应用内主题',
    description: '在“Lumi 成长”页把已解锁颜色应用到 Lumi 形象',
    free: '—',
    plus: '可用',
    pro: '可用',
  },
  {
    key: 'history',
    name: '历史月份回顾',
    description: '在“Lumi 成长”页回看有足迹的历史月份',
    free: '—',
    plus: '可用',
    pro: '可用',
  },
  {
    key: 'annual',
    name: '年度时光回顾',
    description: '在“Lumi 成长”页查看年度统计、故事与跨年对比',
    free: '—',
    plus: '—',
    pro: '可用',
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
): boolean => capsuleCount < FREE_TIME_CAPSULE_LIMIT || Boolean(
  (growth?.plusUntil && growth.plusUntil > now)
  || (growth?.proUntil && growth.proUntil > now),
)

// 会员为一次性购买，不会自动续费；到期状态用于购买页的续费提示与到期提醒开关。
export const MEMBERSHIP_EXPIRING_SOON_DAYS = 7

export const membershipDaysLeft = (until: number | undefined, now = Date.now()): number =>
  until && until > now ? Math.max(1, Math.ceil((until - now) / DAY)) : 0

export const getMembershipLevelView = (
  growth?: GrowthPreferences,
  now = Date.now(),
): MembershipLevelView => {
  const plusUntil = growth?.plusUntil || 0
  const proUntil = growth?.proUntil || 0
  const isPro = proUntil > now
  const isPlus = plusUntil > now
  const trialEndsAt = (growth?.trialStartedAt || 0) + 7 * DAY
  const isTrial = isPlus
    && !isPro
    && Boolean(growth?.trialStartedAt)
    && plusUntil <= trialEndsAt + 60_000

  if (isPro) {
    return {
      level: 'pro',
      title: 'Pro 会员',
      badge: 'PRO',
      summary: '年度时光回顾，以及全部 Plus 权益',
      expiresAt: proUntil,
      daysLeft: membershipDaysLeft(proUntil, now),
    }
  }
  if (isTrial) {
    return {
      level: 'trial',
      title: 'Plus 体验中',
      badge: '体验',
      summary: '正在体验历史月份回顾、不限胶囊与 Lumi 主题',
      expiresAt: plusUntil,
      daysLeft: membershipDaysLeft(plusUntil, now),
    }
  }
  if (isPlus) {
    return {
      level: 'plus',
      title: 'Plus 会员',
      badge: 'PLUS',
      summary: '历史月份回顾、不限胶囊与 Lumi 主题',
      expiresAt: plusUntil,
      daysLeft: membershipDaysLeft(plusUntil, now),
    }
  }
  return {
    level: 'free',
    title: '免费版',
    badge: 'FREE',
    summary: '升级 Plus，回看历史月份并解锁不限胶囊',
    daysLeft: 0,
  }
}

export const isMembershipExpiringSoon = (until: number | undefined, now = Date.now()): boolean => {
  const daysLeft = membershipDaysLeft(until, now)
  return daysLeft > 0 && daysLeft <= MEMBERSHIP_EXPIRING_SOON_DAYS
}
