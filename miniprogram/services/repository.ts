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

let sessionReady = false
let cloudReady = false
let cloudInitialized = false
let cloudRetryAfter = 0
let loginPromise: Promise<UserProfile> | null = null
let profileCache: UserProfile | null = null
const LEGACY_SHARE_SNAPSHOTS_KEY = 'shiguangji:share-snapshots'
const CLOUD_RETRY_DELAY_MS = 30_000

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
  footprintDetailCache.set(footprint.id, footprint)
  const stored = getStored<Footprint[]>(STORAGE_KEYS.footprints, [])
  const next = stored.some((item) => item.id === footprint.id)
    ? stored.map((item) => item.id === footprint.id ? footprint : item)
    : [footprint, ...stored]
  try {
    await setStoredAsync(STORAGE_KEYS.footprints, next)
  } catch (error) {
    console.warn('[repository] footprint detail persistence failed', error)
  }
}

// 仅更新内存缓存与 globalData，不回写存储：用于本地兜底读取，避免大列表的重复同步 IO
const rememberFootprints = (list: Footprint[]): void => {
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
  if (USE_CLOUD && !cloudReady && Date.now() >= cloudRetryAfter) return loginForAccess()
  return ensureLocalProfile()
}

export const hasSessionAccess = (): boolean => sessionReady
export const hasCloudAccess = (): boolean => cloudReady
export const getLocalProfile = (): UserProfile => ensureLocalProfile()

export const loginForAccess = async (): Promise<UserProfile> => {
  if (!USE_CLOUD && sessionReady) return ensureLocalProfile()
  if (!USE_CLOUD) {
    sessionReady = true
    return ensureLocalProfile()
  }
  if (cloudReady) return ensureLocalProfile()
  if (Date.now() < cloudRetryAfter) return ensureLocalProfile()
  if (loginPromise) return loginPromise
  if (!initializeCloud()) {
    sessionReady = true
    return ensureLocalProfile()
  }

  loginPromise = (async () => {
    try {
      const profile = migrateLegacyDefaultProfile(await callCloud<UserProfile>('login', {}))
      cloudReady = true
      cloudRetryAfter = 0
      sessionReady = true
      setStored(STORAGE_KEYS.profile, profile)
      return rememberProfile(profile)
    } catch {
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
  patch: Partial<Pick<GrowthPreferences, 'lockedColorId' | 'iconColorId' | 'viewedMonthlyReports'>>,
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
  const next: UserProfile = {
    ...current,
    growth: { ...current.growth, ...patch },
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

const readStoredFootprints = (): Footprint[] => {
  const summaries = getStored<Footprint[]>(STORAGE_KEYS.footprintSummaries, [])
  const details = getStored<Footprint[]>(STORAGE_KEYS.footprints, [])
  return summaries.length ? summaries : details
}

export const listFootprints = async (
  options: { maxAgeMs?: number } = {},
): Promise<Footprint[]> => {
  const maxAgeMs = options.maxAgeMs ?? 0
  if (footprintListCache && maxAgeMs > 0 && Date.now() - footprintListCachedAt < maxAgeMs) {
    return footprintListCache
  }
  if (!footprintsInFlight) {
    footprintsInFlight = (async () => {
      if (USE_CLOUD && cloudReady) {
        try {
          const cloud = await listCloudFootprints()
          await persistCloudSnapshot(cloud)
          return cloud
        } catch {
          // fall back to local
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
export const getFootprintSnapshot = (): Footprint[] | null => footprintListCache

export const getProfileSnapshot = (): UserProfile | null => profileCache

export const getFootprint = async (
  id: string,
  options: { force?: boolean } = {},
): Promise<Footprint | undefined> => {
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
      return footprint
    } catch {
      // 网络抖动时继续尝试本地快照。
    }
  }
  const storedDetail = getStored<Footprint[]>(STORAGE_KEYS.footprints, [])
    .find((fp) => fp.id === id && !fp.isSummary)
  return storedDetail || (await listFootprints()).find((fp) => fp.id === id)
}

export const saveFootprint = async (draft: FootprintDraft): Promise<Footprint> => {
  const now = Date.now()
  const profile = await ensureProfile()
  const footprint: Footprint = {
    ...draft,
    placeId: draft.placeId || placeKey(draft),
    id: draft.id || createId('fp'),
    userId: profile.id,
    clientRequestId: createId('req'),
    createdAt: now,
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
    const cached = footprintListCache || readStoredFootprints()
    const summary = toFootprintSummary(saved)
    const next = cached.some((fp) => fp.id === saved.id)
      ? cached.map((fp) => fp.id === saved.id ? summary : fp)
      : [summary, ...cached]
    // 两份缓存写入不同 storage key，可并行落盘；云函数成功后不再串行等待两次 IO。
    await Promise.all([
      persistCloudDetail(saved),
      persistCloudSnapshot(next),
    ])
    return saved
  }

  const list = await listFootprints()
  const next = list.some((fp) => fp.id === footprint.id)
    ? list.map((fp) => fp.id === footprint.id ? footprint : fp)
    : [footprint, ...list]
  await syncFootprintCache(next)
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
    footprintDetailCache.delete(id)
    const storedDetails = getStored<Footprint[]>(STORAGE_KEYS.footprints, [])
    await setStoredAsync(STORAGE_KEYS.footprints, storedDetails.filter((item) => item.id !== id))
    const cached = footprintListCache || readStoredFootprints()
    await persistCloudSnapshot(updateAfterDelete(cached))
    return
  }
  const local = await listFootprints()
  const deleted = local.find((item) => item.id === id)
  await syncFootprintCache(updateAfterDelete(local))
  if (deleted) await deleteLocalFiles([...(deleted.photos || []), ...(deleted.photoThumbs || [])])
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
    await persistCloudDetail(result.visit)
    await persistCloudDetail(result.wish)
    const cached = footprintListCache || readStoredFootprints()
    await persistCloudSnapshot([
      toFootprintSummary(result.visit),
      ...cached.map((item) => item.id === wishId ? toFootprintSummary(result.wish) : item),
    ])
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
  await syncFootprintCache([visit, ...list.map((item) => item.id === wishId ? fulfilledWish : item)])
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
  await footprintWriteQueue.catch(() => undefined)
  const profile = getStored<UserProfile | null>(STORAGE_KEYS.profile, null)
  const footprints = getStored<Footprint[]>(STORAGE_KEYS.footprints, [])
  const legacySnapshots = getStored<Array<{ imageUrl?: string }>>(LEGACY_SHARE_SNAPSHOTS_KEY, [])
  if (USE_CLOUD && cloudReady) {
    await callCloud('accountMutation', { action: 'deleteAccount' })
  }
  await deleteLocalFiles([
    profile?.avatarUrl,
    ...footprints.flatMap((fp) => [...fp.photos, ...(fp.photoThumbs || [])]),
    ...legacySnapshots.map((snapshot) => snapshot.imageUrl),
  ])
  Object.values(STORAGE_KEYS).forEach((key) => wx.removeStorageSync(key))
  wx.removeStorageSync(LEGACY_SHARE_SNAPSHOTS_KEY)
  footprintListCache = null
  footprintListCachedAt = 0
  footprintDetailCache.clear()
  sessionReady = false
  cloudReady = false
  cloudRetryAfter = 0
  loginPromise = null
  profileCache = null
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
