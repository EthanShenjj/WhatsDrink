export const CLOUD_ENV_ID = 'ethan-workspace-d7f7k5ma0befbf77'
export const USE_CLOUD = CLOUD_ENV_ID.length > 0
export const APP_VERSION = '1.2.4'
// Optional Tencent Location Service personalized map. Keep subkey empty for the native default map.
// Style numbers must be published under the same subkey in the WeChat/Tencent map console.
export const MAP_STYLE_SUBKEY = ''
export const MAP_STYLE_IDS = { clean: 1, journal: 2, night: 3 } as const
// Fill with the approved WeChat subscription template ID when reminders are enabled.
export const CAPSULE_TEMPLATE_ID = ''
// 与服务端 sendMembershipReminder 的 MEMBERSHIP_REMIND_DAYS 默认值一致，仅用于提示文案。
export const MEMBERSHIP_REMIND_DAYS = 3

export const STORAGE_KEYS = {
  profile: 'shiguangji:profile',
  footprints: 'shiguangji:footprints',
  footprintSummaries: 'shiguangji:footprint-summaries',
  pendingFootprints: 'shiguangji:pending-footprints',
  mapSettings: 'shiguangji:map-settings',
  travelPlans: 'shiguangji:travel-plans',
  timeCapsules: 'shiguangji:time-capsules',
  paymentOrders: 'shiguangji:payment-orders',
  draft: 'shiguangji:footprint-draft',
} as const

export const COLLECTIONS = {
  profiles: 'user_profiles',
  footprints: 'footprints',
  travelPlans: 'travel_plans',
  timeCapsules: 'time_capsules',
  paymentOrders: 'payment_orders',
  userEntitlements: 'user_entitlements',
} as const
