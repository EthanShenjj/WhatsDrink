import type {
  Footprint,
  FootprintDraft,
  UserProfile,
  TravelPlan,
  TravelPlanDraft,
  TimeCapsule,
  TimeCapsuleDraft,
  MapSettings,
  GrowthPreferences,
  CreatePaymentOrderResult,
  MembershipAccount,
  PaymentOrder,
  PaymentProductId,
} from '../domain/types'
import { createId } from '../utils/id'
import { CLOUD_ENV_ID, STORAGE_KEYS, USE_CLOUD } from './config'
import { DEFAULT_MAP_SETTINGS } from '../data/options'
import { todayKey } from '../utils/date'
import { placeKey } from '../utils/footprint'
import { hasTimeCapsuleCapacity } from '../utils/payment'
import { fitImageWithin } from '../utils/image'
import { locationRegion, shortCity, shortProvince } from '../utils/location'
import { provinceAt } from '../utils/province-map'

let sessionReady = false
let cloudReady = false
let cloudInitialized = false
let cloudRetryAfter = 0
let loginPromise: Promise<UserProfile> | null = null
let profileCache: UserProfile | null = null
let authEpoch = 0
const SIGNED_OUT_KEY = 'shiguangji:signed-out'
const LEGACY_SHARE_SNAPSHOTS_KEY = 'shiguangji:share-snapshots'
const CLOUD_RETRY_DELAY_MS = 30_000

export const isSignedOut = (): boolean => {
  try {
    return wx.getStorageSync<boolean>(SIGNED_OUT_KEY) === true
  } catch {
    return false
  }
}

const signedOutProfile = (): UserProfile => ({
  id: 'signed-out', nickname: '', avatarUrl: '', createdAt: 0, updatedAt: 0,
})

const getStored = <T>(key: string, fallback: T): T => {
  if (isSignedOut()) return fallback
  try {
    return wx.getStorageSync<T>(key) || fallback
  } catch {
    return fallback
  }
}

const setStored = <T>(key: string, value: T): void => {
  wx.setStorageSync(key, value)
}

interface PendingFootprint {
  action: 'create' | 'update' | 'delete' | 'fulfillWishlist'
  footprint: Footprint
  wishId?: string
  revision?: string
  edited?: boolean
}
const pendingFootprints = (): PendingFootprint[] => getStored(STORAGE_KEYS.pendingFootprints, [])
const enqueueFootprint = (entry: PendingFootprint): void => {
  const queue = pendingFootprints()
  const previous = queue.find((item) => item.footprint.id === entry.footprint.id)
  if (previous?.action === 'create' && entry.action === 'update') {
    entry.action = 'create'
    entry.edited = true
    entry.footprint.clientRequestId = previous.footprint.clientRequestId
  }
  if (previous?.action === 'fulfillWishlist' && entry.action === 'update') {
    entry.action = 'fulfillWishlist'
    entry.wishId = previous.wishId
  }
  entry.revision ||= createId('sync')
  setStored(STORAGE_KEYS.pendingFootprints, [
    ...queue.filter((item) => item.footprint.id !== entry.footprint.id), entry,
  ])
}
const normalizeLocation = (fp: Footprint): Footprint => {
  const parsed = locationRegion(fp.address || '')
  const province = shortProvince(fp.province || parsed.province || '') || (
    typeof fp.lat === 'number' && typeof fp.lng === 'number' ? provinceAt(fp.lat, fp.lng) || '' : ''
  )
  return {
    ...fp, province: province || undefined,
    city: shortCity(fp.city || parsed.city || (['北京', '上海', '天津', '重庆'].includes(province) ? province : '')) || undefined,
    country: fp.country || parsed.country || (province ? '中国' : undefined),
    district: fp.district || parsed.district || undefined,
  }
}
const mergePendingFootprints = (list: Footprint[]): Footprint[] => {
  const merged = new Map(list.map((item) => [item.id, normalizeLocation(item)]))
  for (const entry of pendingFootprints()) {
    if (entry.action === 'delete') merged.delete(entry.footprint.id)
    else {
      merged.set(entry.footprint.id, normalizeLocation({ ...entry.footprint, pendingSync: true }))
      if (entry.action === 'fulfillWishlist' && entry.wishId) {
        const wish = merged.get(entry.wishId)
        if (wish) merged.set(wish.id, { ...wish, status: 'fulfilled', pendingSync: true, fulfilledVisitId: entry.footprint.id })
      }
    }
  }
  return [...merged.values()]
}

const setStoredAsync = <T>(key: string, value: T): Promise<void> =>
  new Promise((resolve, reject) => {
    if (typeof wx.setStorage !== 'function') {
      try {
        setStored(key, value)
        resolve()
      } catch (error) {
        reject(error)
      }
      return
    }
    wx.setStorage({ key, data: value, success: () => resolve(), fail: reject })
  })

// 足迹列表体积会随照片和记录数增长。串行持久化可避免连续保存时多次同步
// JSON 序列化阻塞点击线程，也确保旧写入不会晚于新写入落盘。
let footprintWriteQueue: Promise<void> = Promise.resolve()

const syncFootprintCache = (list: Footprint[]): Promise<void> => {
  const snapshot = [...list]
  const storedDetails = new Map(
    getStored<Footprint[]>(STORAGE_KEYS.footprints, [])
      .filter((item) => !item.isSummary)
      .map((item) => [item.id, item]),
  )
  const persisted = snapshot.map((item) => item.isSummary ? storedDetails.get(item.id) || item : item)
  rememberFootprints(snapshot)
  wx.removeStorageSync(STORAGE_KEYS.footprintSummaries)
  footprintWriteQueue = footprintWriteQueue
    .catch(() => undefined)
    .then(() => setStoredAsync(STORAGE_KEYS.footprints, persisted))
  return footprintWriteQueue
}

const persistCloudSnapshot = async (list: Footprint[]): Promise<void> => {
  list = mergePendingFootprints(list)
  try {
    rememberFootprints(list)
    footprintWriteQueue = footprintWriteQueue
      .catch(() => undefined)
      .then(() => setStoredAsync(STORAGE_KEYS.footprintSummaries, list))
    await footprintWriteQueue
  } catch (error) {
    // 云端操作已经成功时不能因本地缓存写入失败向用户报告业务失败。
    console.warn('[repository] footprint cache persistence failed', error)
  }
}

const persistCloudDetail = async (footprint: Footprint): Promise<void> => {
  footprint = normalizeLocation(footprint)
  footprintDetailCache.set(footprint.id, footprint)
  try {
    footprintWriteQueue = footprintWriteQueue.catch(() => undefined).then(() => {
      const stored = getStored<Footprint[]>(STORAGE_KEYS.footprints, [])
      const next = stored.some((item) => item.id === footprint.id)
        ? stored.map((item) => item.id === footprint.id ? footprint : item)
        : [footprint, ...stored]
      return setStoredAsync(STORAGE_KEYS.footprints, next)
    })
    await footprintWriteQueue
  } catch (error) {
    console.warn('[repository] footprint detail persistence failed', error)
  }
}

// 仅更新内存缓存与 globalData，不回写存储：用于本地兜底读取，避免大列表的重复同步 IO
const rememberFootprints = (list: Footprint[]): void => {
  if (isSignedOut()) return
  footprintListCache = list
  footprintListCachedAt = Date.now()
  try {
    const app = getApp<IAppOption>()
    app.globalData.footprints = list
    app.globalData.footprintsCachedAt = Date.now()
  } catch {
    // Unit contexts can use the repository without an initialized App.
  }
}

const rememberProfile = (profile: UserProfile): UserProfile => {
  if (isSignedOut()) return signedOutProfile()
  profileCache = profile
  try {
    getApp<IAppOption>().globalData.profile = profile
  } catch {
    // Unit contexts can use the repository without an initialized App.
  }
  return profile
}

const migrateLegacyDefaultProfile = (profile: UserProfile): UserProfile =>
  (profile.nickname === '饮品记录者' || profile.nickname === '拾光者') && !profile.avatarUrl
    ? { ...profile, nickname: '' }
    : profile

const ensureLocalProfile = (): UserProfile => {
  if (isSignedOut()) return signedOutProfile()
  if (profileCache) return profileCache
  const existing = getStored<UserProfile | null>(STORAGE_KEYS.profile, null)
  if (existing) {
    const profile = migrateLegacyDefaultProfile(existing)
    if (profile !== existing) setStored(STORAGE_KEYS.profile, profile)
    return rememberProfile(profile)
  }
  const now = Date.now()
  const profile: UserProfile = {
    id: 'local-user',
    nickname: '',
    avatarUrl: '',
    createdAt: now,
    updatedAt: now,
  }
  setStored(STORAGE_KEYS.profile, profile)
  return rememberProfile(profile)
}

class CloudBusinessError extends Error {}
const callCloud = async <T>(name: string, data: object): Promise<T> => {
  const response = await wx.cloud.callFunction({ name, data })
  const result = response.result as { ok: boolean; data?: T; message?: string }
  if (!result?.ok) throw new CloudBusinessError(result?.message || '云端操作失败')
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
  if (cloudInitialized) return true
  try {
    wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true })
    cloudInitialized = true
    return true
  } catch {
    return false
  }
}

export const ensureProfile = async (): Promise<UserProfile> => {
  if (isSignedOut()) return signedOutProfile()
  if (USE_CLOUD && !cloudReady && Date.now() >= cloudRetryAfter) return loginForAccess()
  return ensureLocalProfile()
}

export const hasSessionAccess = (): boolean => sessionReady && !isSignedOut()
export const hasCloudAccess = (): boolean => cloudReady && !isSignedOut()
export const getLocalProfile = (): UserProfile => ensureLocalProfile()

export const loginForAccess = async (options: { force?: boolean } = {}): Promise<UserProfile> => {
  if (isSignedOut()) return signedOutProfile()
  if (!USE_CLOUD && sessionReady) return ensureLocalProfile()
  if (!USE_CLOUD) {
    sessionReady = true
    return ensureLocalProfile()
  }
  if (cloudReady) return ensureLocalProfile()
  if (!options.force && Date.now() < cloudRetryAfter) return ensureLocalProfile()
  if (loginPromise) return loginPromise
  if (!initializeCloud()) {
    sessionReady = true
    return ensureLocalProfile()
  }

  const requestEpoch = authEpoch
  loginPromise = (async () => {
    try {
      const profile = migrateLegacyDefaultProfile(await callCloud<UserProfile>('login', {}))
      if (requestEpoch !== authEpoch || isSignedOut()) return signedOutProfile()
      cloudReady = true
      cloudRetryAfter = 0
      sessionReady = true
      setStored(STORAGE_KEYS.profile, profile)
      return rememberProfile(profile)
    } catch {
      if (requestEpoch !== authEpoch || isSignedOut()) return signedOutProfile()
      cloudReady = false
      cloudRetryAfter = Date.now() + CLOUD_RETRY_DELAY_MS
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

export const signOutAccount = (): void => {
  authEpoch += 1
  wx.setStorageSync(SIGNED_OUT_KEY, true)
  sessionReady = false
  cloudReady = false
  cloudRetryAfter = 0
  loginPromise = null
  profileCache = null
  footprintListCache = null
  footprintListCachedAt = 0
  footprintDetailCache.clear()
  footprintsInFlight = null
  pendingSyncRerun = false
  try {
    const app = getApp<IAppOption>()
    app.globalData.profile = undefined
    app.globalData.footprints = []
    app.globalData.footprintsCachedAt = 0
    app.globalData.cloudEnabled = false
  } catch {
    // App is not available in isolated repository use.
  }
}

export const resumeAccount = async (): Promise<UserProfile> => {
  if (!isSignedOut()) return loginForAccess({ force: true })
  if (!initializeCloud()) throw new Error('无法连接云端，请联网后重试')
  const requestEpoch = ++authEpoch
  try {
    const profile = migrateLegacyDefaultProfile(await callCloud<UserProfile>('login', {}))
    if (requestEpoch !== authEpoch) throw new Error('登录已取消，请重试')
    wx.removeStorageSync(SIGNED_OUT_KEY)
    sessionReady = true
    cloudReady = true
    cloudRetryAfter = 0
    setStored(STORAGE_KEYS.profile, profile)
    return rememberProfile(profile)
  } catch (error) {
    if (error instanceof CloudBusinessError) throw error
    if (error instanceof Error && error.message === '登录已取消，请重试') throw error
    throw new Error('无法连接云端，请联网后重试')
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
    return rememberProfile(profile)
  }
  const current = await ensureProfile()
  const next = { ...current, ...patch, updatedAt: Date.now() }
  if (current.avatarUrl && current.avatarUrl !== next.avatarUrl) {
    await deleteLocalFiles([current.avatarUrl])
  }
  setStored(STORAGE_KEYS.profile, next)
  return rememberProfile(next)
}

export const saveGrowthPreferences = async (
  patch: Partial<Pick<GrowthPreferences, 'iconColorId' | 'viewedMonthlyReports'>> & {
    lockedColorId?: GrowthPreferences['lockedColorId'] | null
  },
): Promise<UserProfile> => {
  if (USE_CLOUD && cloudReady) {
    const profile = await callCloud<UserProfile>('accountMutation', {
      action: 'saveGrowthPreferences',
      patch,
    })
    setStored(STORAGE_KEYS.profile, profile)
    return rememberProfile(profile)
  }
  const current = await ensureProfile()
  const { lockedColorId, ...otherPatch } = patch
  const growth: GrowthPreferences = { ...current.growth, ...otherPatch }
  if (Object.prototype.hasOwnProperty.call(patch, 'lockedColorId')) {
    if (lockedColorId) growth.lockedColorId = lockedColorId
    else delete growth.lockedColorId
  }
  const next: UserProfile = {
    ...current,
    growth,
    updatedAt: Date.now(),
  }
  setStored(STORAGE_KEYS.profile, next)
  return rememberProfile(next)
}

export const startGrowthTrial = async (): Promise<UserProfile> => {
  if (USE_CLOUD && cloudReady) {
    const profile = await callCloud<UserProfile>('accountMutation', { action: 'startGrowthTrial' })
    setStored(STORAGE_KEYS.profile, profile)
    return rememberProfile(profile)
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
  return rememberProfile(next)
}

// ─── Membership & Virtual Payment ───

const loginCode = (): Promise<string> =>
  new Promise((resolve, reject) => {
    wx.login({
      success: (result) => result.code ? resolve(result.code) : reject(new Error('未取得微信登录凭证')),
      fail: reject,
    })
  })

const syncMembershipAccount = (account: MembershipAccount): MembershipAccount => {
  setStored(STORAGE_KEYS.profile, account.profile)
  setStored(STORAGE_KEYS.paymentOrders, account.orders)
  rememberProfile(account.profile)
  return account
}

export const getMembershipAccount = async (): Promise<MembershipAccount> => {
  if (USE_CLOUD && !cloudReady) await loginForAccess()
  if (USE_CLOUD && cloudReady) {
    const account = await callCloud<MembershipAccount>('paymentMutation', { action: 'account' })
    return syncMembershipAccount(account)
  }
  return {
    profile: await ensureProfile(),
    orders: getStored<PaymentOrder[]>(STORAGE_KEYS.paymentOrders, []),
  }
}

export const createPaymentOrder = async (
  productId: PaymentProductId,
): Promise<CreatePaymentOrderResult> => {
  if (USE_CLOUD && !cloudReady) await loginForAccess()
  if (!USE_CLOUD || !cloudReady) {
    throw new Error('微信支付需要登录已部署的云开发环境')
  }
  const code = await loginCode()
  const result = await callCloud<CreatePaymentOrderResult>('paymentMutation', {
    action: 'createOrder',
    productId,
    code,
  })
  const orders = getStored<PaymentOrder[]>(STORAGE_KEYS.paymentOrders, [])
  setStored(STORAGE_KEYS.paymentOrders, [
    result.order,
    ...orders.filter((order) => order.outTradeNo !== result.order.outTradeNo),
  ])
  return result
}

export const getPaymentOrder = async (outTradeNo: string): Promise<PaymentOrder> => {
  if (USE_CLOUD && !cloudReady) await loginForAccess()
  if (!USE_CLOUD || !cloudReady) {
    const local = getStored<PaymentOrder[]>(STORAGE_KEYS.paymentOrders, [])
      .find((order) => order.outTradeNo === outTradeNo)
    if (!local) throw new Error('订单不存在')
    return local
  }
  const order = await callCloud<PaymentOrder>('paymentMutation', {
    action: 'getOrder',
    outTradeNo,
  })
  const orders = getStored<PaymentOrder[]>(STORAGE_KEYS.paymentOrders, [])
  setStored(STORAGE_KEYS.paymentOrders, [
    order,
    ...orders.filter((item) => item.outTradeNo !== order.outTradeNo),
  ])
  return order
}

// 到期提醒依赖一次性订阅授权：授权记录保存在云端 reminder_subscriptions，
// 关闭开关会删除未使用的授权，已发出的提醒无法撤回。
export const saveReminderSubscription = async (
  templateId: string,
  enabled: boolean,
): Promise<{ enabled: boolean; count: number }> => {
  if (USE_CLOUD && !cloudReady) await loginForAccess()
  if (!USE_CLOUD || !cloudReady) {
    throw new Error('到期提醒需要登录已部署的云开发环境')
  }
  return callCloud<{ enabled: boolean; count: number }>('paymentMutation', {
    action: 'saveReminderSubscription',
    templateId,
    enabled,
  })
}

const listCloudFootprints = (): Promise<Footprint[]> =>
  callCloud<Footprint[]>('footprintMutation', { action: 'list' })

const getCloudFootprint = (id: string): Promise<Footprint> =>
  callCloud<Footprint>('footprintMutation', { action: 'get', id })

const toFootprintSummary = (footprint: Footprint): Footprint => {
  const photoThumbs = footprint.photoThumbs?.slice(0, 1) || []
  return {
    ...footprint,
    photos: photoThumbs.length ? [] : footprint.photos.slice(0, 1),
    photoThumbs,
    photoCount: footprint.photoCount ?? footprint.photos.length,
    isSummary: true,
  }
}

// 内存级足迹缓存：配合 maxAgeMs 供多个页面复用同一次全量请求
let footprintListCache: Footprint[] | null = null
let footprintListCachedAt = 0
const footprintDetailCache = new Map<string, Footprint>()
// 多页面同时触发刷新时共享同一个进行中的请求，避免重复云调用
let footprintsInFlight: Promise<Footprint[]> | null = null
let footprintCloudLoadFailed = false

const readStoredFootprints = (): Footprint[] => {
  const summaries = getStored<Footprint[]>(STORAGE_KEYS.footprintSummaries, [])
  const details = getStored<Footprint[]>(STORAGE_KEYS.footprints, [])
  // 兼容旧版离线记录：旧版没有队列，但 local-user 明确表示从未云端确认。
  const queued = new Set(pendingFootprints().map((entry) => entry.footprint.id))
  for (const fp of details) {
    if (USE_CLOUD && fp.userId === 'local-user' && !queued.has(fp.id) && !fp.isSummary && fp.status !== 'fulfilled' && !fp.wishId && !fp.convertedFromWishlist) {
      enqueueFootprint({ action: 'create', footprint: { ...normalizeLocation(fp), pendingSync: true } })
    }
  }
  for (const wish of details.filter((fp) => fp.userId === 'local-user' && fp.status === 'fulfilled')) {
    if (!USE_CLOUD || queued.has(wish.id)) continue
    const visit = details.find((fp) => fp.wishId === wish.id || fp.id === wish.fulfilledVisitId)
    if (visit) {
      enqueueFootprint({ action: 'create', footprint: { ...normalizeLocation(wish), status: 'wishlist', fulfilledVisitId: undefined, fulfilledAt: undefined, pendingSync: true } })
      if (!queued.has(visit.id)) enqueueFootprint({ action: 'fulfillWishlist', footprint: normalizeLocation(visit), wishId: wish.id })
    }
  }
  return mergePendingFootprints(summaries.length ? summaries : details)
}

let pendingSyncPromise: Promise<void> | null = null
let pendingSyncRerun = false
/** 后台同步不阻塞列表首屏；失败的意图和图片仍保留在本机。 */
export const syncPendingFootprints = (): Promise<void> => {
  if (!USE_CLOUD || !cloudReady || isSignedOut()) return Promise.resolve()
  if (pendingSyncPromise) {
    pendingSyncRerun = true
    return pendingSyncPromise
  }
  readStoredFootprints()
  pendingSyncPromise = (async () => {
    for (const original of pendingFootprints()) {
      if (isSignedOut()) break
      if (original.footprint.userId !== 'local-user' && original.footprint.userId !== profileCache?.id) continue
      try {
        const fp = { ...original.footprint }
        if (original.action !== 'delete') {
          for (const field of ['photos', 'photoThumbs'] as const) {
            fp[field] = await Promise.all((fp[field] || []).map((path) =>
              path.startsWith('wxfile://') || path.startsWith('/') ? uploadPhoto(path) : Promise.resolve(path),
            ))
          }
        }
        const current = pendingFootprints().find((item) => item.footprint.id === fp.id)
        if (!current || current.revision !== original.revision) continue
        // 在云端确认前持久化已上传的文件引用，重试不会丢照片。
        enqueueFootprint({ ...original, footprint: fp })
        let saved: Footprint | undefined
        let wish: Footprint | undefined
        if (original.action === 'fulfillWishlist') {
          const result = await callCloud<{ visit: Footprint; wish: Footprint }>('footprintMutation', { action: 'fulfillWishlist', id: original.wishId, visit: fp })
          saved = result.visit
          wish = result.wish
        } else if (original.action === 'delete') {
          try {
            await callCloud('footprintMutation', { action: 'delete', id: fp.id })
          } catch (error) {
            if (!(error instanceof CloudBusinessError && error.message === '足迹不存在或无权操作')) throw error
          }
        } else {
          saved = await callCloud<Footprint>('footprintMutation', { action: original.action, footprint: fp })
          if (original.edited) saved = await callCloud<Footprint>('footprintMutation', { action: 'update', footprint: { ...fp, id: saved.id } })
        }
        const beforeSync = footprintListCache || readStoredFootprints()
        if (isSignedOut()) break
        const latest = pendingFootprints()
        // 用户在同步期间编辑或删除了这条记录时，旧响应不能覆盖新意图。
        if (!latest.some((item) => item.footprint.id === fp.id && item.revision === original.revision)) continue
        setStored(STORAGE_KEYS.pendingFootprints, latest.filter((item) =>
          item.footprint.id !== fp.id || item.revision !== original.revision,
        ))
        let next = beforeSync.filter((item) => item.id !== fp.id)
        footprintDetailCache.delete(fp.id)
        if (!saved || saved.id !== fp.id) {
          await setStoredAsync(STORAGE_KEYS.footprints, getStored<Footprint[]>(STORAGE_KEYS.footprints, []).filter((item) => item.id !== fp.id))
        }
        if (saved) {
          saved = { ...normalizeLocation(saved), pendingSync: false, syncError: undefined }
          await persistCloudDetail(saved)
          next = [toFootprintSummary(saved), ...next]
        }
        if (wish) {
          await persistCloudDetail(wish)
          next = next.map((item) => item.id === wish!.id ? toFootprintSummary(wish!) : item)
        }
        await persistCloudSnapshot(next)
      } catch (error) {
        console.warn('[repository] pending sync deferred', error)
        if (error instanceof CloudBusinessError) {
          const current = pendingFootprints().find((entry) => entry.footprint.id === original.footprint.id)
          if (current && current.revision === original.revision) enqueueFootprint({ ...current, footprint: { ...current.footprint, syncError: error.message } })
          continue
        }
        const current = pendingFootprints().find((entry) => entry.footprint.id === original.footprint.id)
        if (current && current.revision === original.revision) {
          enqueueFootprint({ ...current, footprint: { ...current.footprint, syncError: '网络连接不稳定，稍后自动重试' } })
          const cached = footprintListCache || readStoredFootprints()
          rememberFootprints(mergePendingFootprints(cached))
        }
        break
      }
    }
  })().finally(() => {
    pendingSyncPromise = null
    if (pendingSyncRerun) {
      pendingSyncRerun = false
      void syncPendingFootprints()
    }
  })
  return pendingSyncPromise
}

export const listFootprints = async (
  options: { maxAgeMs?: number } = {},
): Promise<Footprint[]> => {
  if (isSignedOut()) return []
  const maxAgeMs = options.maxAgeMs ?? 0
  if (footprintListCache && maxAgeMs > 0 && Date.now() - footprintListCachedAt < maxAgeMs) {
    return footprintListCache
  }
  if (!footprintsInFlight) {
    footprintsInFlight = (async () => {
      if (USE_CLOUD && cloudReady) {
        try {
          const cloud = await listCloudFootprints()
          footprintCloudLoadFailed = false
          readStoredFootprints()
          await persistCloudSnapshot(cloud)
          const merged = footprintListCache || mergePendingFootprints(cloud)
          void syncPendingFootprints()
          return merged
        } catch (error) {
          footprintCloudLoadFailed = true
          console.warn('[repository] footprint list using local cache', error)
        }
      }
      const local = readStoredFootprints()
      rememberFootprints(local)
      return local
    })().finally(() => {
      footprintsInFlight = null
    })
  }
  return footprintsInFlight
}

/** 同步读取当前内存快照，供页面在点击后立即渲染；没有缓存时返回 null。 */
export const getFootprintSnapshot = (): Footprint[] | null => isSignedOut() ? null : footprintListCache
export const didFootprintCloudLoadFail = (): boolean => footprintCloudLoadFailed

export const getProfileSnapshot = (): UserProfile | null => isSignedOut() ? null : profileCache

export const getFootprint = async (
  id: string,
  options: { force?: boolean } = {},
): Promise<Footprint | undefined> => {
  if (isSignedOut()) return undefined
  const pending = pendingFootprints().find((item) => item.footprint.id === id)
  if (pending) return pending.action === 'delete' ? undefined : normalizeLocation({ ...pending.footprint, pendingSync: true })
  const detail = footprintDetailCache.get(id)
  if (detail && !options.force) return detail
  if (footprintListCache && !options.force) {
    const cached = footprintListCache.find((fp) => fp.id === id)
    if (cached && !cached.isSummary) return cached
  }
  if (USE_CLOUD && cloudReady) {
    try {
      const footprint = await getCloudFootprint(id)
      await persistCloudDetail(footprint)
      return normalizeLocation(footprint)
    } catch {
      // 网络抖动时继续尝试本地快照。
    }
  }
  const storedDetail = getStored<Footprint[]>(STORAGE_KEYS.footprints, [])
    .find((fp) => fp.id === id && !fp.isSummary)
  return storedDetail ? normalizeLocation(storedDetail) : (await listFootprints()).find((fp) => fp.id === id)
}

export const saveFootprint = async (draft: FootprintDraft): Promise<Footprint> => {
  const now = Date.now()
  const profile = await ensureProfile()
  const queuedDraft = draft.id ? pendingFootprints().find((entry) => entry.footprint.id === draft.id) : undefined
  const clientRequestId = queuedDraft?.action === 'create' ? queuedDraft.footprint.clientRequestId : draft.clientRequestId || createId('req')
  const footprint: Footprint = normalizeLocation({
    ...draft,
    placeId: draft.recordLevel === 'city' ? undefined : draft.placeId || placeKey(draft),
    id: draft.id || `fp_${clientRequestId}`,
    userId: profile.id,
    clientRequestId,
    createdAt: now,
    updatedAt: now,
  })
  if (draft.id) {
    const existing = await getFootprint(draft.id)
    if (existing) footprint.createdAt = existing.createdAt
  }

  const queued = pendingFootprints().find((item) => item.footprint.id === footprint.id)
  const action = queued?.action === 'create' ? 'create' : draft.id ? 'update' : 'create'
  if (USE_CLOUD && cloudReady && queued?.action !== 'fulfillWishlist' && ![...footprint.photos, ...(footprint.photoThumbs || [])].some((path) => path.startsWith('wxfile://') || path.startsWith('/'))) {
    try {
      let saved = await callCloud<Footprint>('footprintMutation', { action, footprint })
      if (draft.id && action === 'create') saved = await callCloud<Footprint>('footprintMutation', { action: 'update', footprint: { ...footprint, id: saved.id } })
      const cached = footprintListCache || readStoredFootprints()
      setStored(STORAGE_KEYS.pendingFootprints, pendingFootprints().filter((entry) => entry.footprint.id !== footprint.id))
      const summary = toFootprintSummary(saved)
      const next = cached.some((fp) => fp.id === saved.id)
        ? cached.map((fp) => fp.id === saved.id ? summary : fp)
        : [summary, ...cached]
      await Promise.all([persistCloudDetail(saved), persistCloudSnapshot(next)])
      return saved
    } catch (error) {
      if (error instanceof CloudBusinessError) throw error
      // 超时也可能已经写入云端。保留相同 id / requestId，后台安全重试。
      console.warn('[repository] save queued', error)
    }
  }

  footprint.pendingSync = USE_CLOUD
  if (USE_CLOUD) enqueueFootprint({ action: draft.id ? 'update' : 'create', footprint })
  const list = footprintListCache || readStoredFootprints()
  const next = list.some((fp) => fp.id === footprint.id)
    ? list.map((fp) => fp.id === footprint.id ? footprint : fp)
    : [footprint, ...list]
  await syncFootprintCache(next)
  void syncPendingFootprints()
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
  const local = footprintListCache || readStoredFootprints()
  const deleted = local.find((item) => item.id === id)
  if (USE_CLOUD && deleted) enqueueFootprint({ action: 'delete', footprint: { ...deleted, updatedAt: Date.now() } })
  footprintDetailCache.delete(id)
  await syncFootprintCache(updateAfterDelete(local))
  if (deleted) void deleteLocalFiles([...(deleted.photos || []), ...(deleted.photoThumbs || [])]).catch(() => undefined)
  if (USE_CLOUD && deleted) void syncPendingFootprints()
}

export const fulfillWishlistFootprint = async (
  wishId: string,
  draft: FootprintDraft,
): Promise<{ wish: Footprint; visit: Footprint }> => {
  const wish = await getFootprint(wishId)
  if (!wish || wish.status !== 'wishlist') throw new Error('愿望不存在或已实现')
  await ensureProfile()
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
  if (USE_CLOUD && cloudReady && !pendingFootprints().some((item) => item.footprint.id === wishId)) {
    try {
      const result = await callCloud<{ wish: Footprint; visit: Footprint }>('footprintMutation', {
        action: 'fulfillWishlist', id: wishId, visit: visitDraft,
      })
      await persistCloudDetail(result.visit)
      await persistCloudDetail(result.wish)
      const cached = footprintListCache || readStoredFootprints()
      await persistCloudSnapshot([
        toFootprintSummary(result.visit),
        ...cached.map((item) => item.id === wishId ? toFootprintSummary(result.wish) : item),
      ])
      return result
    } catch (error) {
      if (error instanceof CloudBusinessError) throw error
      console.warn('[repository] wishlist fulfillment queued', error)
    }
  }
  const now = Date.now()
  const requestId = draft.clientRequestId || createId('req')
  const visit: Footprint = {
    ...visitDraft,
    id: `fp_${requestId}`,
    userId: wish.userId,
    clientRequestId: requestId,
    createdAt: now,
    updatedAt: now,
    pendingSync: USE_CLOUD,
  }
  const fulfilledWish: Footprint = {
    ...wish,
    status: 'fulfilled',
    fulfilledAt: now,
    fulfilledVisitId: visit.id,
    updatedAt: now,
    pendingSync: USE_CLOUD,
  }
  const list = footprintListCache || readStoredFootprints()
  if (USE_CLOUD) enqueueFootprint({ action: 'fulfillWishlist', footprint: visit, wishId })
  await syncFootprintCache([visit, ...list.map((item) => item.id === wishId ? fulfilledWish : item)])
  void syncPendingFootprints()
  return { wish: fulfilledWish, visit }
}

const prepareImage = async (
  tempFilePath: string,
  maxEdge: number,
  quality: number,
): Promise<string> => {
  try {
    const info = await new Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult>((resolve, reject) => {
      wx.getImageInfo({ src: tempFilePath, success: resolve, fail: reject })
    })
    const target = fitImageWithin(info.width, info.height, maxEdge)
    return await new Promise<string>((resolve, reject) => {
      wx.compressImage({
        src: tempFilePath,
        quality,
        compressedWidth: target.width,
        compressedHeight: target.height,
        success: (result) => resolve(result.tempFilePath),
        fail: reject,
      })
    })
  } catch {
    // 个别旧格式或旧基础库不支持尺寸压缩时仍允许保存原图。
    return tempFilePath
  }
}

const saveLocalImage = (tempFilePath: string): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    wx.getFileSystemManager().saveFile({
      tempFilePath,
      success: (res) => resolve(res.savedFilePath),
      fail: reject,
    })
  })

const uploadPreparedImage = async (tempFilePath: string, cloudPath: string): Promise<string> => {
  if (!USE_CLOUD || !cloudReady) return saveLocalImage(tempFilePath)
  const res = await wx.cloud.uploadFile({ cloudPath, filePath: tempFilePath })
  return res.fileID
}

const uploadToken = (): string => `${Date.now()}-${Math.random().toString(36).slice(2)}`

export const uploadPhoto = async (tempFilePath: string): Promise<string> => {
  const prepared = await prepareImage(tempFilePath, 1600, 82)
  const profile = await ensureProfile()
  return uploadPreparedImage(
    prepared,
    `footprint-photos/${profile.id}/${uploadToken()}.jpg`,
  )
}

export interface UploadedFootprintPhoto {
  photo: string
  thumbnail: string
}

/** 足迹原图限制长边 1600px，同时生成 480px 列表缩略图。 */
export const uploadFootprintPhoto = async (tempFilePath: string): Promise<UploadedFootprintPhoto> => {
  const profile = await ensureProfile()
  const token = uploadToken()
  const [preparedPhoto, preparedThumbnail] = await Promise.all([
    prepareImage(tempFilePath, 1600, 82),
    prepareImage(tempFilePath, 480, 72),
  ])
  const photo = await uploadPreparedImage(
    preparedPhoto,
    `footprint-photos/${profile.id}/${token}-full.jpg`,
  )
  try {
    const thumbnail = await uploadPreparedImage(
      preparedThumbnail,
      `footprint-photos/${profile.id}/${token}-thumb.jpg`,
    )
    return { photo, thumbnail }
  } catch (error) {
    await deletePhotos([photo])
    throw error
  }
}

export const uploadPhotos = async (tempPaths: string[]): Promise<string[]> =>
  runWithConcurrency(tempPaths, 2, uploadPhoto)

const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

export const deletePhotos = async (paths: Array<string | undefined>): Promise<void> => {
  const validPaths = paths.filter((path): path is string => Boolean(path))
  if (USE_CLOUD && cloudReady) {
    const cloudPaths = validPaths.filter((p) => p.startsWith('cloud://'))
    if (cloudPaths.length) {
      await wx.cloud.deleteFile({ fileList: cloudPaths }).catch(() => undefined)
    }
  }
  await deleteLocalFiles(validPaths)
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
  if (!draft.id) {
    const existingCapsules = await listTimeCapsules()
    if (!hasTimeCapsuleCapacity(existingCapsules.length, profile.growth, now)) {
      throw new Error('免费版最多可创建 3 个时光胶囊，开通会员后不限数量')
    }
  }
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

// ─── Account ───

export const clearAllData = async (): Promise<void> => {
  await pendingSyncPromise?.catch(() => undefined)
  await footprintWriteQueue.catch(() => undefined)
  const allFootprints = getStored<Footprint[]>(STORAGE_KEYS.footprints, [])
  const legacySnapshots = getStored<Array<{ imageUrl?: string }>>(LEGACY_SHARE_SNAPSHOTS_KEY, [])
  if (USE_CLOUD && cloudReady) {
    await callCloud('accountMutation', { action: 'clearAll' })
  }
  await deletePhotos(allFootprints.flatMap((fp) => [...fp.photos, ...(fp.photoThumbs || [])]))
  await deleteLocalFiles(legacySnapshots.map((snapshot) => snapshot.imageUrl))
  Object.values(STORAGE_KEYS).forEach((key) => {
    if (key !== STORAGE_KEYS.profile) wx.removeStorageSync(key)
  })
  wx.removeStorageSync(LEGACY_SHARE_SNAPSHOTS_KEY)
  footprintListCache = null
  footprintListCachedAt = 0
  footprintDetailCache.clear()
  try {
    const app = getApp<IAppOption>()
    app.globalData.footprints = []
    app.globalData.footprintsCachedAt = Date.now()
  } catch {
    // App is not available in isolated repository use.
  }
}

export const deleteAccount = async (): Promise<void> => {
  if (USE_CLOUD && !cloudReady) await loginForAccess({ force: true })
  if (USE_CLOUD && !cloudReady) {
    throw new Error('无法连接云端，请联网后重试注销')
  }
  const waitForWrites = async (pending: Promise<unknown> | null): Promise<void> => {
    if (!pending) return
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        pending.catch(() => undefined),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('仍有记录正在同步，请稍后重试注销')), 15_000)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  await waitForWrites(pendingSyncPromise)
  await waitForWrites(footprintWriteQueue)
  const profile = getStored<UserProfile | null>(STORAGE_KEYS.profile, null)
  const footprints = getStored<Footprint[]>(STORAGE_KEYS.footprints, [])
  const legacySnapshots = getStored<Array<{ imageUrl?: string }>>(LEGACY_SHARE_SNAPSHOTS_KEY, [])
  if (USE_CLOUD) {
    await callCloud('accountMutation', { action: 'deleteAccount' })
  }
  await deleteLocalFiles([
    profile?.avatarUrl,
    ...footprints.flatMap((fp) => [...fp.photos, ...(fp.photoThumbs || [])]),
    ...legacySnapshots.map((snapshot) => snapshot.imageUrl),
  ])
  Object.values(STORAGE_KEYS).forEach((key) => wx.removeStorageSync(key))
  wx.removeStorageSync(LEGACY_SHARE_SNAPSHOTS_KEY)
  wx.removeStorageSync('sgj:product-events-pending')
  wx.removeStorageSync('sgj:first-open-tracked')
  footprintListCache = null
  footprintListCachedAt = 0
  footprintDetailCache.clear()
  sessionReady = false
  cloudReady = false
  cloudRetryAfter = 0
  loginPromise = null
  profileCache = null
  try {
    const app = getApp<IAppOption>()
    app.globalData.profile = undefined
    app.globalData.footprints = []
    app.globalData.footprintsCachedAt = Date.now()
    app.globalData.cloudEnabled = false
  } catch {
    // App is not available in isolated repository use.
  }
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
