export type FootprintStatus = 'visited' | 'wishlist' | 'fulfilled'
export type FootprintSource = 'manual' | 'ai' | 'import'
export type FootprintVisibility = 'private' | 'share_only'
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
  mood?: string
  category?: string
  tags: string[]
  note?: string
  markerStyle?: MarkerStyle
  visibility: FootprintVisibility
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
}

export interface FootprintDraftAI {
  poiName?: string
  visitDate?: string
  mood?: string
  category?: string
  tags?: string[]
  note?: string
  photos?: string[]
  lat?: number
  lng?: number
  address?: string
  confidence: number
  needsPoiConfirmation: boolean
  dateWasDefaulted?: boolean
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
  lockedColorId?: GrowthColorId
  iconColorId?: GrowthColorId
  viewedMonthlyReports?: string[]
}

export type PaymentProductId = 'plus_31d_v1' | 'plus_372d_v1'

export interface PaymentProduct {
  id: PaymentProductId
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
}

export interface GrowthSnapshot {
  weeklyColorId: GrowthColorId
  activeColorId: GrowthColorId
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
  colors: GrowthColorView[]
  expressions: GrowthExpressionView[]
  hiddenStates: GrowthHiddenStateView[]
  recentVisitCount: number
  monthVisitCount: number
  monthCityCount: number
  fulfilledCount: number
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

export interface ShareCardConfig {
  type: 'place' | 'map'
  footprintId?: string
  scope?: string
  hideAddress: boolean
  hideDate: boolean
  hideNote: boolean
}

export interface ShareSnapshot {
  id: string
  type: 'place' | 'map'
  imageUrl: string
  createdAt: number
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
