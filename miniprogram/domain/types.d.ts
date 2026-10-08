export type FootprintStatus = 'visited' | 'wishlist' | 'fulfilled'
export type FootprintSource = 'manual' | 'ai' | 'import'
export type MapMode = 'visited' | 'wishlist' | 'lighting'

export interface MarkerStyle {
  color?: string
  emoji?: string
  label?: string
}

export interface Footprint {
  id: string
  userId: string
  status: FootprintStatus
  /** 旧记录未设置此字段时按具体地点处理。 */
  recordLevel?: 'city' | 'place'
  poiName: string
  address?: string
  lat?: number
  lng?: number
  country?: string
  province?: string
  city?: string
  district?: string
  visitDate?: string
  photos: string[]
  /** 与 photos 下标对齐的轻量预览图；旧记录为空时回退原图。 */
  photoThumbs?: string[]
  /** 摘要接口保留的原始照片总数。 */
  photoCount?: number
  /** 仅客户端列表摘要使用，不写入业务数据。 */
  isSummary?: boolean
  /** 已安全保存到本机，等待云端确认。 */
  pendingSync?: boolean
  syncError?: string
  mood?: string
  category?: string
  tags: string[]
  note?: string
  markerStyle?: MarkerStyle
  source: FootprintSource
  placeId?: string
  wishId?: string
  isImportant?: boolean
  wishlistCreatedAt?: number
  fulfilledAt?: number
  fulfilledVisitId?: string
  convertedFromWishlist?: boolean
  clientRequestId: string
  createdAt: number
  updatedAt: number
}

export type FootprintDraft = Omit<
  Footprint,
  'id' | 'userId' | 'clientRequestId' | 'createdAt' | 'updatedAt'
> & {
  id?: string
  clientRequestId?: string
}

export interface UserProfile {
  id: string
  nickname: string
  avatarUrl: string
  growth?: GrowthPreferences
  createdAt: number
  updatedAt: number
}

export type GrowthColorId =
  | 'journey'
  | 'explore'
  | 'discover'
  | 'highlight'
  | 'companion'
  | 'dawn'

export type GrowthExpressionId =
  | 'default'
  | 'happy'
  | 'thinking'
  | 'depart'
  | 'explore'
  | 'record'
  | 'companion'
  | 'reunion'

export interface GrowthPreferences {
  trialStartedAt?: number
  plusUntil?: number
  proUntil?: number
  lockedColorId?: GrowthColorId
  iconColorId?: GrowthColorId
  viewedMonthlyReports?: string[]
}

export type MembershipLevel = 'free' | 'trial' | 'plus' | 'pro'

export interface MembershipLevelView {
  level: MembershipLevel
  title: string
  badge: string
  summary: string
  expiresAt?: number
  daysLeft: number
}

export interface MembershipBenefit {
  key: 'core' | 'capsules' | 'theme' | 'history' | 'annual'
  name: string
  description: string
  free: string
  plus: string
  pro: string
}

export type MembershipTier = 'plus' | 'pro'
export type PaymentProductId = 'plus_31d_v1' | 'plus_372d_v1' | 'pro_372d_v1'

export interface PaymentProduct {
  id: PaymentProductId
  tier: MembershipTier
  name: string
  shortName: string
  description: string
  priceFen: number
  days: number
  badge?: string
}

export type PaymentOrderStatus =
  | 'pending'
  | 'paid'
  | 'fulfilled'
  | 'refunded'
  | 'failed'

export interface PaymentOrder {
  id: string
  outTradeNo: string
  wxOrderId?: string
  productId: PaymentProductId
  productName: string
  amountFen: number
  status: PaymentOrderStatus
  entitlementStartsAt?: number
  entitlementEndsAt?: number
  createdAt: number
  updatedAt: number
  paidAt?: number
  fulfilledAt?: number
  refundedAt?: number
}

export interface VirtualPaymentData {
  mode: 'short_series_goods'
  signData: string
  paySig: string
  signature: string
}

export interface CreatePaymentOrderResult {
  order: PaymentOrder
  payData: VirtualPaymentData
}

export interface MembershipAccount {
  profile: UserProfile
  orders: PaymentOrder[]
  /** 是否曾有已生效订单；用于区分免费用户和已过期付费用户 */
  hasFulfilledOrder?: boolean
  /** 服务端启用的会员到期提醒模板；为空时客户端隐藏提醒入口 */
  reminderTemplateId?: string
  /** 服务端仍保留的到期提醒一次性订阅授权条数 */
  reminderAuthorizations?: number
}

export interface PaymentOrderPage {
  orders: PaymentOrder[]
  total: number
  nextOffset: number
  hasMore: boolean
}

export interface GrowthColorView {
  id: GrowthColorId
  name: string
  shortName: string
  description: string
  unlocked: boolean
  hidden?: boolean
}

export interface GrowthExpressionView {
  id: GrowthExpressionId
  name: string
  description: string
  unlocked: boolean
  mascotState: GrowthColorId
}

export interface GrowthHiddenStateView {
  id: 'dawn' | 'seasons' | 'distance' | 'hometown' | 'reunion' | 'annual'
  name: string
  hint: string
  unlocked: boolean
  mascotState: GrowthColorId
  expression: string
}

export interface GrowthSnapshot {
  weeklyColorId: GrowthColorId
  activeColorId: GrowthColorId
  colorMode: 'auto' | 'fixed'
  displayTitle: string
  weeklyTitle: string
  weeklyMessage: string
  monthlyColorId: GrowthColorId
  monthlyTitle: string
  monthKey: string
  monthLabel: string
  monthlySummary: string
  shards: number
  nextGoalText: string
  nextGoalProgress: number
  nextGoalTarget: number
  isPlus: boolean
  plusDaysLeft: number
  isPro: boolean
  proDaysLeft: number
  colors: GrowthColorView[]
  expressions: GrowthExpressionView[]
  hiddenStates: GrowthHiddenStateView[]
  recentVisitCount: number
  monthVisitCount: number
  monthCityCount: number
  fulfilledCount: number
}

/** 主导航只需要的轻量成长信息，避免每次点击执行完整成就扫描。 */
export interface GrowthOverview {
  weeklyColorId: GrowthColorId
  activeColorId: GrowthColorId
  colorMode: 'auto' | 'fixed'
  displayTitle: string
  weeklyTitle: string
  weeklyMessage: string
  nextGoalText: string
  nextGoalProgress: number
  nextGoalTarget: number
  isPlus: boolean
  plusDaysLeft: number
  isPro: boolean
  proDaysLeft: number
}

export interface HistoricalMonthReport {
  key: string
  year: number
  month: number
  label: string
  title: string
  summary: string
  visitCount: number
  cityCount: number
  fulfilledCount: number
}

export interface AnnualMemoryReport {
  year: number
  label: string
  title: string
  summary: string
  visitCount: number
  cityCount: number
  photoCount: number
  fulfilledCount: number
  comparisonText?: string
}

export interface LightingStats {
  countries: number
  provinces: number
  cities: number
  places: number
  visitedCount: number
  wishlistCount: number
  fulfilledWishCount: number
  photoCount: number
  litProvinces: string[]
  litCities: string[]
}

export interface CityGrowth {
  key: string
  city: string
  province?: string
  level: 1 | 2 | 3
  places: number
  latitude?: number
  longitude?: number
}

export interface MemoryDrop {
  id: string
  footprint: Footprint
  kind: 'anniversary' | 'recent'
  title: string
}

export interface FilterState {
  dateStart?: string
  dateEnd?: string
  country?: string
  province?: string
  city?: string
  category?: string
  mood?: string
}

export interface MonthCell {
  key: string
  day: number
  date: Date
  inMonth: boolean
  isToday: boolean
  footprintCount: number
  previewPhoto?: string
  previewMood?: string
}

export interface WeekDayView {
  date: Date
  key: string
  weekday: string
  day: number
  isToday: boolean
}

export interface TravelPlan {
  id: string
  userId: string
  title: string
  city: string
  days: number
  preferences: string[]
  poiIds: string[]
  dayPlans: TravelDayPlan[]
  status: 'planning' | 'ongoing' | 'completed'
  createdAt: number
  updatedAt: number
}

export interface TravelDayPlan {
  day: number
  poiIds: string[]
  note?: string
}

export type TravelPlanDraft = Omit<TravelPlan, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & {
  id?: string
}

export interface TimeCapsule {
  id: string
  userId: string
  title: string
  footprintId?: string
  text?: string
  photos: string[]
  unlockDate: string
  status: 'locked' | 'unlocked'
  subscriptionId?: string
  createdAt: number
  updatedAt: number
  unlockedAt?: number
}

export type TimeCapsuleDraft = Omit<TimeCapsule, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & {
  id?: string
}

export interface MapSettings {
  markerStyle: 'dot' | 'emoji' | 'label' | 'cluster'
  theme: 'clean' | 'journal' | 'night'
  clusterEnabled: boolean
}

export interface ClusterMarker {
  id: number
  latitude: number
  longitude: number
  count: number
  footprintIds: string[]
}
