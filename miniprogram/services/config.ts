export const CLOUD_ENV_ID = 'ethan-workspace-d7f7k5ma0befbf77'
export const USE_CLOUD = CLOUD_ENV_ID.length > 0
// Optional Tencent Location Service personalized map. Keep subkey empty for the native default map.
// Style numbers must be published under the same subkey in the WeChat/Tencent map console.
export const MAP_STYLE_SUBKEY = ''
export const MAP_STYLE_IDS = { clean: 1, journal: 2, night: 3 } as const
// Fill with the approved WeChat subscription template ID when reminders are enabled.
export const CAPSULE_TEMPLATE_ID = ''

export const STORAGE_KEYS = {
  profile: 'shiguangji:profile',
  footprints: 'shiguangji:footprints',
  mapSettings: 'shiguangji:map-settings',
  travelPlans: 'shiguangji:travel-plans',
  timeCapsules: 'shiguangji:time-capsules',
  shareSnapshots: 'shiguangji:share-snapshots',
  draft: 'shiguangji:footprint-draft',
} as const

export const COLLECTIONS = {
  profiles: 'user_profiles',
  footprints: 'footprints',
  travelPlans: 'travel_plans',
  timeCapsules: 'time_capsules',
  shareSnapshots: 'share_snapshots',
} as const
