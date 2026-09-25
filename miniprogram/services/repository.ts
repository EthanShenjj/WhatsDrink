import type {
  Footprint,
  FootprintDraft,
  UserProfile,
  TravelPlan,
  TravelPlanDraft,
  TimeCapsule,
  TimeCapsuleDraft,
  ShareSnapshot,
  MapSettings,
  GrowthPreferences,
} from '../domain/types'
import { createId } from '../utils/id'
import { CLOUD_ENV_ID, STORAGE_KEYS, USE_CLOUD } from './config'
import { DEFAULT_MAP_SETTINGS } from '../data/options'
import { todayKey } from '../utils/date'
import { placeKey } from '../utils/footprint'

let sessionReady = false
let cloudReady = false
let loginPromise: Promise<UserProfile> | null = null

const getStored = <T>(key: string, fallback: T): T => {
  try {
    return wx.getStorageSync<T>(key) || fallback
  } catch {
    return fallback
  }
}

const setStored = <T>(key: string, value: T): void => {
  wx.setStorageSync(key, value)
}

const syncFootprintCache = (list: Footprint[]): void => {
  setStored(STORAGE_KEYS.footprints, list)
  try {
    const app = getApp<IAppOption>()
    app.globalData.footprints = list
    app.globalData.footprintsCachedAt = Date.now()
  } catch {
    // Unit contexts can use the repository without an initialized App.
  }
}

const migrateLegacyDefaultProfile = (profile: UserProfile): UserProfile =>
  profile.nickname === '饮品记录者' && !profile.avatarUrl
    ? { ...profile, nickname: '拾光者' }
    : profile

const ensureLocalProfile = (): UserProfile => {
  const existing = getStored<UserProfile | null>(STORAGE_KEYS.profile, null)
  if (existing) {
    const profile = migrateLegacyDefaultProfile(existing)
    if (profile !== existing) setStored(STORAGE_KEYS.profile, profile)
    return profile
  }
  const now = Date.now()
  const profile: UserProfile = {
    id: 'local-user',
    nickname: '拾光者',
    avatarUrl: '',
    createdAt: now,
    updatedAt: now,
  }
  setStored(STORAGE_KEYS.profile, profile)
  return profile
}

const callCloud = async <T>(name: string, data: object): Promise<T> => {
  const response = await wx.cloud.callFunction({ name, data })
  const result = response.result as { ok: boolean; data?: T; message?: string }
  if (!result?.ok) throw new Error(result?.message || '云端操作失败')
  return result.data as T
}

const deleteLocalFiles = async (paths: Array<string | undefined>): Promise<void> => {
  const fm = wx.getFileSystemManager()
  await Promise.all(
    paths
      .filter((p): p is string => Boolean(p && p.startsWith('wxfile://')))
      .map(
        (path) =>
          new Promise<void>((resolve) => {
            fm.unlink({ filePath: path, success: () => resolve(), fail: () => resolve() })
          }),
      ),
  )
}

export const initializeCloud = (): boolean => {
  if (!USE_CLOUD || !wx.cloud) return false
  try {
    wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true })
    return true
  } catch {
    return false
  }
}

export const ensureProfile = async (): Promise<UserProfile> => {
  if (USE_CLOUD && !sessionReady) return loginForAccess()
  return ensureLocalProfile()
}

export const hasSessionAccess = (): boolean => sessionReady

export const loginForAccess = async (): Promise<UserProfile> => {
  if (!USE_CLOUD && sessionReady) return ensureLocalProfile()
  if (!USE_CLOUD) {
    sessionReady = true
    return ensureLocalProfile()
  }
  if (cloudReady) return ensureLocalProfile()
  if (loginPromise) return loginPromise

  loginPromise = (async () => {
    try {
      const profile = migrateLegacyDefaultProfile(await callCloud<UserProfile>('login', {}))
      cloudReady = true
      sessionReady = true
      setStored(STORAGE_KEYS.profile, profile)
      return profile
    } catch {
      sessionReady = true
      return ensureLocalProfile()
    }
  })()

  try {
    return await loginPromise
  } finally {
    loginPromise = null
  }
}

export const saveProfile = async (
  patch: Pick<UserProfile, 'nickname' | 'avatarUrl'>,
): Promise<UserProfile> => {
  if (USE_CLOUD && cloudReady) {
    const profile = await callCloud<UserProfile>('accountMutation', {
      action: 'saveProfile',
      patch,
    })
    setStored(STORAGE_KEYS.profile, profile)
    return profile
  }
  const current = await ensureProfile()
  const next = { ...current, ...patch, updatedAt: Date.now() }
  if (current.avatarUrl && current.avatarUrl !== next.avatarUrl) {
    await deleteLocalFiles([current.avatarUrl])
  }
  setStored(STORAGE_KEYS.profile, next)
  return next
}

export const saveGrowthPreferences = async (
  patch: Partial<Pick<GrowthPreferences, 'lockedColorId' | 'iconColorId' | 'viewedMonthlyReports'>>,
): Promise<UserProfile> => {
  if (USE_CLOUD && cloudReady) {
    const profile = await callCloud<UserProfile>('accountMutation', {
      action: 'saveGrowthPreferences',
      patch,
    })
    setStored(STORAGE_KEYS.profile, profile)
    return profile
  }
  const current = await ensureProfile()
  const next: UserProfile = {
    ...current,
    growth: { ...current.growth, ...patch },
    updatedAt: Date.now(),
  }
  setStored(STORAGE_KEYS.profile, next)
  return next
}

export const startGrowthTrial = async (): Promise<UserProfile> => {
  if (USE_CLOUD && cloudReady) {
    const profile = await callCloud<UserProfile>('accountMutation', { action: 'startGrowthTrial' })
    setStored(STORAGE_KEYS.profile, profile)
    return profile
  }
  const current = await ensureProfile()
  if (current.growth?.trialStartedAt) return current
  const now = Date.now()
  const next: UserProfile = {
    ...current,
    growth: {
      ...current.growth,
      trialStartedAt: now,
      plusUntil: now + 7 * 86_400_000,
    },
    updatedAt: now,
  }
  setStored(STORAGE_KEYS.profile, next)
  return next
}

const listCloudFootprints = (): Promise<Footprint[]> =>
  callCloud<Footprint[]>('footprintMutation', { action: 'list' })

export const listFootprints = async (): Promise<Footprint[]> => {
  if (USE_CLOUD && cloudReady) {
    try {
      const cloud = await listCloudFootprints()
      syncFootprintCache(cloud)
      return cloud
    } catch {
      // fall back to local
    }
  }
  return getStored<Footprint[]>(STORAGE_KEYS.footprints, [])
}

export const getFootprint = async (id: string): Promise<Footprint | undefined> =>
  (await listFootprints()).find((fp) => fp.id === id)

export const saveFootprint = async (draft: FootprintDraft): Promise<Footprint> => {
  const now = Date.now()
  const profile = await ensureProfile()
  const footprint: Footprint = {
    ...draft,
    placeId: draft.placeId || placeKey(draft),
    id: draft.id || createId('fp'),
    userId: profile.id,
    clientRequestId: createId('req'),
    createdAt: draft.id ? now : now,
    updatedAt: now,
  }
  if (draft.id) {
    const existing = await getFootprint(draft.id)
    if (existing) footprint.createdAt = existing.createdAt
  }

  if (USE_CLOUD && cloudReady) {
    const saved = await callCloud<Footprint>('footprintMutation', {
      action: draft.id ? 'update' : 'create',
      footprint,
    })
    const cached = getStored<Footprint[]>(STORAGE_KEYS.footprints, [])
    const idx = cached.findIndex((fp) => fp.id === saved.id)
    if (idx >= 0) cached[idx] = saved
    else cached.unshift(saved)
    syncFootprintCache(cached)
    return saved
  }

  const list = await listFootprints()
  const idx = list.findIndex((fp) => fp.id === footprint.id)
  if (idx >= 0) list[idx] = footprint
  else list.unshift(footprint)
  syncFootprintCache(list)
  return footprint
}

export const deleteFootprint = async (id: string): Promise<void> => {
  const updateAfterDelete = (list: Footprint[]): Footprint[] => {
    const deleted = list.find((fp) => fp.id === id)
    return list.filter((fp) => fp.id !== id).map((fp) => {
      if (deleted?.wishId === fp.id && fp.fulfilledVisitId === id) {
        return { ...fp, status: 'wishlist' as const, fulfilledAt: undefined, fulfilledVisitId: undefined }
      }
      if (deleted?.fulfilledVisitId === fp.id && fp.wishId === id) {
        return { ...fp, wishId: undefined, wishlistCreatedAt: undefined, convertedFromWishlist: false }
      }
      return fp
    })
  }
  if (USE_CLOUD && cloudReady) {
    await callCloud('footprintMutation', { action: 'delete', id })
    const cached = getStored<Footprint[]>(STORAGE_KEYS.footprints, [])
    syncFootprintCache(updateAfterDelete(cached))
    return
  }
  syncFootprintCache(updateAfterDelete(await listFootprints()))
}

export const fulfillWishlistFootprint = async (
  wishId: string,
  draft: FootprintDraft,
): Promise<{ wish: Footprint; visit: Footprint }> => {
  const wish = await getFootprint(wishId)
  if (!wish || wish.status !== 'wishlist') throw new Error('愿望不存在或已实现')
  const visitDraft: FootprintDraft = {
    ...draft,
    id: undefined,
    status: 'visited',
    poiName: wish.poiName,
    placeId: wish.placeId || placeKey(wish),
    wishId,
    wishlistCreatedAt: wish.wishlistCreatedAt || wish.createdAt,
    convertedFromWishlist: true,
  }
  if (USE_CLOUD && cloudReady) {
    const result = await callCloud<{ wish: Footprint; visit: Footprint }>('footprintMutation', {
      action: 'fulfillWishlist',
      id: wishId,
      visit: visitDraft,
    })
    const cached = getStored<Footprint[]>(STORAGE_KEYS.footprints, [])
    syncFootprintCache([result.visit, ...cached.map((item) => item.id === wishId ? result.wish : item)])
    return result
  }
  const now = Date.now()
  const visit: Footprint = {
    ...visitDraft,
    id: createId('fp'),
    userId: wish.userId,
    clientRequestId: createId('req'),
    createdAt: now,
    updatedAt: now,
  }
  const fulfilledWish: Footprint = {
    ...wish,
    status: 'fulfilled',
    fulfilledAt: now,
    fulfilledVisitId: visit.id,
    updatedAt: now,
  }
  const list = await listFootprints()
  syncFootprintCache([visit, ...list.map((item) => item.id === wishId ? fulfilledWish : item)])
  return { wish: fulfilledWish, visit }
}

export const uploadPhoto = async (tempFilePath: string): Promise<string> => {
  if (!USE_CLOUD || !cloudReady) {
    return new Promise<string>((resolve, reject) => {
      wx.getFileSystemManager().saveFile({
        tempFilePath,
        success: (res) => resolve(res.savedFilePath),
        fail: reject,
      })
    })
  }
  const profile = await ensureProfile()
  const cloudPath = `footprint-photos/${profile.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
  const res = await wx.cloud.uploadFile({ cloudPath, filePath: tempFilePath })
  return res.fileID
}

export const uploadPhotos = async (tempPaths: string[]): Promise<string[]> =>
  Promise.all(tempPaths.map((p) => uploadPhoto(p)))

export const deletePhotos = async (paths: string[]): Promise<void> => {
  if (USE_CLOUD && cloudReady) {
    const cloudPaths = paths.filter((p) => p.startsWith('cloud://'))
    if (cloudPaths.length) {
      await wx.cloud.deleteFile({ fileList: cloudPaths }).catch(() => undefined)
    }
  }
  await deleteLocalFiles(paths)
}

// ─── Map Settings ───

export const getMapSettings = (): MapSettings =>
  getStored<MapSettings>(STORAGE_KEYS.mapSettings, DEFAULT_MAP_SETTINGS)

export const saveMapSettings = (settings: MapSettings): void => {
  setStored(STORAGE_KEYS.mapSettings, settings)
}

// ─── Travel Plans ───

export const listTravelPlans = async (): Promise<TravelPlan[]> => {
  if (USE_CLOUD && cloudReady) {
    try {
      const plans = await callCloud<TravelPlan[]>('travelPlanMutation', { action: 'list' })
      setStored(STORAGE_KEYS.travelPlans, plans)
      return plans
    } catch {
      // fall back
    }
  }
  return getStored<TravelPlan[]>(STORAGE_KEYS.travelPlans, [])
}

export const saveTravelPlan = async (draft: TravelPlanDraft): Promise<TravelPlan> => {
  const now = Date.now()
  const profile = await ensureProfile()
  const existing = draft.id
    ? getStored<TravelPlan[]>(STORAGE_KEYS.travelPlans, []).find((item) => item.id === draft.id)
    : undefined
  const plan: TravelPlan = {
    ...draft,
    id: draft.id || createId('plan'),
    userId: profile.id,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  } as TravelPlan

  if (USE_CLOUD && cloudReady) {
    const saved = await callCloud<TravelPlan>('travelPlanMutation', {
      action: draft.id ? 'update' : 'create',
      plan,
    })
    const cached = getStored<TravelPlan[]>(STORAGE_KEYS.travelPlans, [])
    const idx = cached.findIndex((item) => item.id === saved.id)
    if (idx >= 0) cached[idx] = saved
    else cached.unshift(saved)
    setStored(STORAGE_KEYS.travelPlans, cached)
    return saved
  }

  const list = await listTravelPlans()
  const idx = list.findIndex((p) => p.id === plan.id)
  if (idx >= 0) list[idx] = plan
  else list.unshift(plan)
  setStored(STORAGE_KEYS.travelPlans, list)
  return plan
}

export const deleteTravelPlan = async (id: string): Promise<void> => {
  if (USE_CLOUD && cloudReady) {
    await callCloud('travelPlanMutation', { action: 'delete', id })
    const cached = getStored<TravelPlan[]>(STORAGE_KEYS.travelPlans, [])
    setStored(STORAGE_KEYS.travelPlans, cached.filter((plan) => plan.id !== id))
    return
  }
  const list = (await listTravelPlans()).filter((p) => p.id !== id)
  setStored(STORAGE_KEYS.travelPlans, list)
}

// ─── Time Capsules ───

export const listTimeCapsules = async (): Promise<TimeCapsule[]> => {
  if (USE_CLOUD && cloudReady) {
    try {
      const capsules = await callCloud<TimeCapsule[]>('timeCapsuleMutation', { action: 'list' })
      setStored(STORAGE_KEYS.timeCapsules, capsules)
      return capsules
    } catch {
      // fall back
    }
  }
  return getStored<TimeCapsule[]>(STORAGE_KEYS.timeCapsules, [])
}

export const saveTimeCapsule = async (draft: TimeCapsuleDraft): Promise<TimeCapsule> => {
  const now = Date.now()
  const profile = await ensureProfile()
  const existing = draft.id
    ? getStored<TimeCapsule[]>(STORAGE_KEYS.timeCapsules, []).find(
        (item) => item.id === draft.id,
      )
    : undefined
  const capsule: TimeCapsule = {
    ...draft,
    id: draft.id || createId('capsule'),
    userId: profile.id,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  } as TimeCapsule

  if (USE_CLOUD && cloudReady) {
    const saved = await callCloud<TimeCapsule>('timeCapsuleMutation', {
      action: draft.id ? 'update' : 'create',
      capsule,
    })
    const cached = getStored<TimeCapsule[]>(STORAGE_KEYS.timeCapsules, [])
    const idx = cached.findIndex((item) => item.id === saved.id)
    if (idx >= 0) cached[idx] = saved
    else cached.push(saved)
    setStored(STORAGE_KEYS.timeCapsules, cached)
    return saved
  }

  const list = await listTimeCapsules()
  const idx = list.findIndex((c) => c.id === capsule.id)
  if (idx >= 0) list[idx] = capsule
  else list.push(capsule)
  setStored(STORAGE_KEYS.timeCapsules, list)
  return capsule
}

export const deleteTimeCapsule = async (id: string): Promise<void> => {
  if (USE_CLOUD && cloudReady) {
    await callCloud('timeCapsuleMutation', { action: 'delete', id })
    const cached = getStored<TimeCapsule[]>(STORAGE_KEYS.timeCapsules, [])
    setStored(STORAGE_KEYS.timeCapsules, cached.filter((capsule) => capsule.id !== id))
    return
  }
  const list = (await listTimeCapsules()).filter((c) => c.id !== id)
  setStored(STORAGE_KEYS.timeCapsules, list)
}

export const unlockTimeCapsule = async (id: string): Promise<TimeCapsule> => {
  if (USE_CLOUD && cloudReady) {
    const unlocked = await callCloud<TimeCapsule>('timeCapsuleMutation', {
      action: 'unlock',
      id,
    })
    const cached = getStored<TimeCapsule[]>(STORAGE_KEYS.timeCapsules, [])
    setStored(
      STORAGE_KEYS.timeCapsules,
      cached.map((item) => (item.id === id ? unlocked : item)),
    )
    return unlocked
  }
  const cached = getStored<TimeCapsule[]>(STORAGE_KEYS.timeCapsules, [])
  const index = cached.findIndex((item) => item.id === id)
  if (index < 0) throw new Error('胶囊不存在')
  const capsule = cached[index]
  if (capsule.unlockDate > todayKey()) {
    throw new Error('尚未到解锁日期')
  }
  const unlocked = { ...capsule, status: 'unlocked' as const, unlockedAt: Date.now() }
  cached[index] = unlocked
  setStored(STORAGE_KEYS.timeCapsules, cached)
  return unlocked
}

// ─── Share Snapshots ───

export const listShareSnapshots = async (): Promise<ShareSnapshot[]> => {
  return getStored<ShareSnapshot[]>(STORAGE_KEYS.shareSnapshots, [])
}

export const saveShareSnapshot = async (snapshot: ShareSnapshot): Promise<void> => {
  const list = await listShareSnapshots()
  list.unshift(snapshot)
  setStored(STORAGE_KEYS.shareSnapshots, list.slice(0, 20))
}

export const getShareCodePath = async (): Promise<string | undefined> => {
  if (!USE_CLOUD || !cloudReady) return undefined
  try {
    const response = await callCloud<{ base64: string }>('shareCode', {})
    if (!response.base64) return undefined
    const filePath = `${wx.env.USER_DATA_PATH}/shiguangji-share-code.png`
    return await new Promise<string | undefined>((resolve) => {
      wx.getFileSystemManager().writeFile({
        filePath,
        data: response.base64,
        encoding: 'base64',
        success: () => resolve(filePath),
        fail: () => resolve(undefined),
      })
    })
  } catch {
    return undefined
  }
}

// ─── AI Assistant ───

export const generateAIDraft = async (
  text: string,
  photoIds: string[] = [],
): Promise<import('../domain/types').FootprintDraftAI> => {
  if (USE_CLOUD && cloudReady) {
    return callCloud('aiAssistant', { action: 'draft', text, photoIds })
  }
  // Local fallback: simple heuristic extraction
  return {
    poiName: text.slice(0, 20),
    visitDate: todayKey(),
    note: text,
    confidence: 0.3,
    needsPoiConfirmation: true,
    dateWasDefaulted: true,
  }
}

// ─── Account ───

export const clearAllData = async (): Promise<void> => {
  const allFootprints = getStored<Footprint[]>(STORAGE_KEYS.footprints, [])
  const allSnapshots = getStored<ShareSnapshot[]>(STORAGE_KEYS.shareSnapshots, [])
  if (USE_CLOUD && cloudReady) {
    await callCloud('accountMutation', { action: 'clearAll' })
  }
  await deletePhotos(allFootprints.flatMap((fp) => fp.photos))
  await deleteLocalFiles(allSnapshots.map((snapshot) => snapshot.imageUrl))
  Object.values(STORAGE_KEYS).forEach((key) => {
    if (key !== STORAGE_KEYS.profile) wx.removeStorageSync(key)
  })
  try {
    const app = getApp<IAppOption>()
    app.globalData.footprints = []
    app.globalData.footprintsCachedAt = Date.now()
  } catch {
    // App is not available in isolated repository use.
  }
}

export const deleteAccount = async (): Promise<void> => {
  const profile = getStored<UserProfile | null>(STORAGE_KEYS.profile, null)
  const footprints = getStored<Footprint[]>(STORAGE_KEYS.footprints, [])
  const snapshots = getStored<ShareSnapshot[]>(STORAGE_KEYS.shareSnapshots, [])
  if (USE_CLOUD && cloudReady) {
    await callCloud('accountMutation', { action: 'deleteAccount' })
  }
  await deleteLocalFiles([
    profile?.avatarUrl,
    ...footprints.flatMap((fp) => fp.photos),
    ...snapshots.map((snapshot) => snapshot.imageUrl),
  ])
  Object.values(STORAGE_KEYS).forEach((key) => wx.removeStorageSync(key))
  sessionReady = false
  cloudReady = false
  loginPromise = null
}

// ─── Draft persistence ───

export const saveDraft = (draft: Partial<FootprintDraft>): void => {
  setStored(STORAGE_KEYS.draft, draft)
}

export const loadDraft = (): Partial<FootprintDraft> | null =>
  getStored<Partial<FootprintDraft> | null>(STORAGE_KEYS.draft, null)

export const clearDraft = (): void => {
  wx.removeStorageSync(STORAGE_KEYS.draft)
}
