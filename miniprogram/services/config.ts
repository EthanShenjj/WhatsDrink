export const CLOUD_ENV_ID = 'ethan-workspace-d7f7-d2a96457337'
export const USE_CLOUD = CLOUD_ENV_ID.length > 0

export const STORAGE_KEYS = {
  profile: 'whatsdrink:profile',
  records: 'whatsdrink:records',
  wheels: 'whatsdrink:wheels',
  recordDraft: 'whatsdrink:record-draft',
} as const
