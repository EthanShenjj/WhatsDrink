export type DrinkCategory = 'coffee' | 'milk_tea'
export type CalorieSource = 'official' | 'estimated' | 'user'

export interface Brand {
  id: string
  name: string
  category: DrinkCategory
  public: true
  version: number
}

export interface Drink {
  id: string
  brandId: string
  brandName: string
  name: string
  category: DrinkCategory
  defaultSize: string
  calorieKcal?: number
  calorieSource: CalorieSource
  public: true
  version: number
}

export interface DrinkRecord {
  id: string
  category: DrinkCategory
  brandId?: string
  brandName: string
  drinkId?: string
  drinkName: string
  size: string
  temperature: string
  sweetness: string
  calorieKcal?: number
  calorieSource: CalorieSource
  priceYuan?: number
  rating?: number
  note: string
  photoPath?: string
  consumedAt: number
  clientRequestId: string
  createdAt: number
  updatedAt: number
}

export interface DrinkRecordDraft
  extends Omit<DrinkRecord, 'id' | 'clientRequestId' | 'createdAt' | 'updatedAt'> {
  id?: string
}

export interface WheelItem {
  id: string
  label: string
  brandId?: string
  drinkId?: string
  brandName?: string
  drinkName?: string
  category?: DrinkCategory
  calorieKcal?: number
}

export interface Wheel {
  id: string
  name: string
  items: WheelItem[]
  createdAt: number
  updatedAt: number
}

export interface UserProfile {
  id: string
  nickname: string
  avatarUrl: string
  createdAt: number
  updatedAt: number
}

export type ReminderSubscriptionDecision = 'accept' | 'reject' | 'ban' | 'filter'

export interface ReminderSubscriptionStatus {
  configured: boolean
  enabled: boolean
  remainingCount: number
  reminderTime: string
  lastDecision: ReminderSubscriptionDecision | ''
  lastSentDate: string
}

export interface DaySummary {
  count: number
  knownCalories: number
  unknownCaloriesCount: number
}

export interface WeekDayView {
  date: Date
  key: string
  weekday: string
  day: number
  isToday: boolean
}
