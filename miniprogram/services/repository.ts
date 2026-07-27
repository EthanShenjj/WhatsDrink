import { BRANDS } from '../data/catalog'
import type {
  DrinkRecord,
  DrinkRecordDraft,
  UserProfile,
  Wheel,
  WheelItem,
} from '../domain/types'
import { createId } from '../utils/id'
import { brandToWheelItem, normalizeWheelItemsToBrands } from '../utils/wheel'
import { CLOUD_ENV_ID, STORAGE_KEYS, USE_CLOUD } from './config'

let recordSessionReady = false
let cloudSessionReady = false
let cloudLoginPromise: Promise<UserProfile> | null = null

const CLOUD_RECORD_PAGE_SIZE = 20

const defaultWheelItems = (): WheelItem[] =>
  BRANDS.filter((brand) =>
    ['starbucks', 'luckin', 'manner', 'tims', 'mstand'].includes(brand.id),
  ).map((brand) => brandToWheelItem(brand, createId('item')))

const normalizeWheel = (wheel: Wheel): Wheel => ({
  ...wheel,
  items: normalizeWheelItemsToBrands(wheel.items || []),
})

const defaultWheel = (): Wheel => {
  const now = Date.now()
  return {
    id: createId('wheel'),
    name: '今天喝什么咖啡',
    items: defaultWheelItems(),
    createdAt: now,
    updatedAt: now,
  }
}

const getStored = <T>(key: string, fallback: T): T => {
  try {
    const value = wx.getStorageSync<T>(key)
    return value || fallback
  } catch {
    return fallback
  }
}

const setStored = <T>(key: string, value: T): void => {
  wx.setStorageSync(key, value)
}

const ensureLocalProfile = (): UserProfile => {
  const existing = getStored<UserProfile | null>(STORAGE_KEYS.profile, null)
  if (existing) return existing
  const now = Date.now()
  const profile: UserProfile = {
    id: 'local-user',
    nickname: '饮品记录者',
    avatarUrl: '',
    createdAt: now,
    updatedAt: now,
  }
  setStored(STORAGE_KEYS.profile, profile)
  return profile
}

const deleteLocalFiles = async (paths: Array<string | undefined>): Promise<void> => {
  const fileSystem = wx.getFileSystemManager()
  await Promise.all(
    paths
      .filter((path): path is string => Boolean(path && path.startsWith('wxfile://')))
      .map(
        (filePath) =>
          new Promise<void>((resolve) => {
            fileSystem.unlink({
              filePath,
              success: () => resolve(),
              fail: () => resolve(),
            })
          }),
      ),
  )
}

const callCloud = async <T>(name: string, data: object): Promise<T> => {
  const response = await wx.cloud.callFunction({ name, data })
  const result = response.result as { ok: boolean; data?: T; message?: string }
  if (!result?.ok) throw new Error(result?.message || '云端操作失败')
  return result.data as T
}

const uploadLocalFileToCloud = async (
  localPath: string,
  cloudPath: string,
): Promise<string> => {
  const result = await wx.cloud.uploadFile({ cloudPath, filePath: localPath })
  return result.fileID
}

const wheelSignature = (wheel: Wheel): string =>
  JSON.stringify({
    name: wheel.name.trim(),
    items: normalizeWheel(wheel).items.map((item) => item.label.trim()),
  })

const listCloudWheels = async (): Promise<Wheel[]> => {
  const db = wx.cloud.database()
  const wheels: Wheel[] = []
  let offset = 0
  while (true) {
    const response = await db
      .collection('wheels')
      .where({ _openid: '{openid}' })
      .orderBy('updatedAt', 'desc')
      .skip(offset)
      .limit(CLOUD_RECORD_PAGE_SIZE)
      .get()
    const page = (response.data as Array<Record<string, unknown>>).map((item) =>
      normalizeWheel({
        ...(item as unknown as Wheel),
        id: String(item.id || item._id),
      }),
    )
    wheels.push(...page)
    if (page.length < CLOUD_RECORD_PAGE_SIZE) break
    offset += CLOUD_RECORD_PAGE_SIZE
  }
  return wheels
}

const migrateLocalDataToCloud = async (cloudProfile: UserProfile): Promise<UserProfile> => {
  const localProfile = getStored<UserProfile | null>(STORAGE_KEYS.profile, null)
  const localRecords = getStored<DrinkRecord[]>(STORAGE_KEYS.records, [])
  const localWheels = getStored<Wheel[]>(STORAGE_KEYS.wheels, [])
  let migratedProfile = cloudProfile

  if (
    localProfile &&
    localProfile.id === 'local-user' &&
    (localProfile.nickname !== '饮品记录者' || Boolean(localProfile.avatarUrl))
  ) {
    let avatarUrl = localProfile.avatarUrl
    if (avatarUrl && !avatarUrl.startsWith('cloud://')) {
      avatarUrl = await uploadLocalFileToCloud(
        avatarUrl,
        `profile-photos/${cloudProfile.id}/avatar.jpg`,
      )
    }
    migratedProfile = await callCloud<UserProfile>('accountMutation', {
      action: 'saveProfile',
      patch: {
        nickname: localProfile.nickname,
        avatarUrl,
      },
    })
  }

  for (const storedRecord of localRecords) {
    const record = {
      ...storedRecord,
      clientRequestId: storedRecord.clientRequestId || `migration:${storedRecord.id}`,
    }
    if (record.photoPath && !record.photoPath.startsWith('cloud://')) {
      record.photoPath = await uploadLocalFileToCloud(
        record.photoPath,
        `record-photos/${cloudProfile.id}/legacy-${record.id}.jpg`,
      )
    }
    await callCloud<DrinkRecord>('recordMutation', {
      action: 'create',
      record,
    })
  }

  if (localWheels.length) {
    const cloudSignatures = new Set((await listCloudWheels()).map(wheelSignature))

    for (const wheel of localWheels.map(normalizeWheel)) {
      if (cloudSignatures.has(wheelSignature(wheel))) continue
      await callCloud<Wheel>('wheelMutation', {
        action: 'save',
        wheel,
      })
    }
  }

  if (localRecords.length) wx.removeStorageSync(STORAGE_KEYS.records)
  if (localWheels.length) wx.removeStorageSync(STORAGE_KEYS.wheels)
  setStored(STORAGE_KEYS.profile, migratedProfile)
  return migratedProfile
}

const establishCloudSession = async (migrateLocal = true): Promise<UserProfile> => {
  if (!recordSessionReady) {
    recordSessionReady = true
  }
  if (!USE_CLOUD) return ensureLocalProfile()
  if (cloudSessionReady) return ensureLocalProfile()
  if (cloudLoginPromise) return cloudLoginPromise

  cloudLoginPromise = (async () => {
    const profile = await callCloud<UserProfile>('login', {})
    const readyProfile = migrateLocal ? await migrateLocalDataToCloud(profile) : profile
    cloudSessionReady = true
    setStored(STORAGE_KEYS.profile, readyProfile)
    return readyProfile
  })()

  try {
    return await cloudLoginPromise
  } finally {
    cloudLoginPromise = null
  }
}

export const initializeCloud = (): boolean => {
  if (!USE_CLOUD || !wx.cloud) return false
  wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true })
  return true
}

export const ensureProfile = async (): Promise<UserProfile> => {
  if (USE_CLOUD && cloudSessionReady) {
    return ensureLocalProfile()
  }
  return ensureLocalProfile()
}

export const hasRecordAccess = (): boolean => recordSessionReady

export const loginForRecordAccess = async (): Promise<UserProfile> => {
  if (!USE_CLOUD && recordSessionReady) return ensureLocalProfile()
  try {
    return await establishCloudSession()
  } catch {
    return ensureLocalProfile()
  }
}

export const saveProfile = async (
  patch: Pick<UserProfile, 'nickname' | 'avatarUrl'>,
): Promise<UserProfile> => {
  if (USE_CLOUD && cloudSessionReady) {
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

export const listRecords = async (): Promise<DrinkRecord[]> => {
  if (USE_CLOUD && cloudSessionReady) {
    const db = wx.cloud.database()
    const records: Array<Record<string, unknown>> = []
    let offset = 0
    while (true) {
      const response = await db
        .collection('drink_records')
        .where({ _openid: '{openid}' })
        .orderBy('consumedAt', 'desc')
        .skip(offset)
        .limit(CLOUD_RECORD_PAGE_SIZE)
        .get()
      const page = response.data as Array<Record<string, unknown>>
      records.push(...page)
      if (page.length < CLOUD_RECORD_PAGE_SIZE) break
      offset += CLOUD_RECORD_PAGE_SIZE
    }
    return records.map((item) => ({
      ...(item as unknown as DrinkRecord),
      id: String(item.id || item._id),
    }))
  }
  return getStored<DrinkRecord[]>(STORAGE_KEYS.records, []).sort(
    (a, b) => b.consumedAt - a.consumedAt,
  )
}

export const getRecord = async (id: string): Promise<DrinkRecord | undefined> =>
  (await listRecords()).find((record) => record.id === id)

export const saveRecord = async (draft: DrinkRecordDraft): Promise<DrinkRecord> => {
  const now = Date.now()
  const record: DrinkRecord = {
    ...draft,
    id: draft.id || createId('record'),
    clientRequestId: createId('request'),
    createdAt: now,
    updatedAt: now,
  }
  if (USE_CLOUD && cloudSessionReady) {
    return callCloud<DrinkRecord>('recordMutation', {
      action: draft.id ? 'update' : 'create',
      record,
    })
  }
  const records = await listRecords()
  const index = records.findIndex((item) => item.id === record.id)
  if (index >= 0) {
    if (records[index].photoPath && records[index].photoPath !== record.photoPath) {
      await deleteLocalFiles([records[index].photoPath])
    }
    record.createdAt = records[index].createdAt
    records[index] = record
  } else {
    records.unshift(record)
  }
  setStored(STORAGE_KEYS.records, records)
  return record
}

export const deleteRecord = async (id: string): Promise<void> => {
  if (USE_CLOUD && cloudSessionReady) {
    await callCloud('recordMutation', { action: 'delete', id })
    return
  }
  const records = await listRecords()
  const target = records.find((record) => record.id === id)
  await deleteLocalFiles([target?.photoPath])
  setStored(STORAGE_KEYS.records, records.filter((record) => record.id !== id))
}

export const listWheels = async (): Promise<Wheel[]> => {
  if (USE_CLOUD && cloudSessionReady) {
    try {
      const wheels = await listCloudWheels()
      if (wheels.length) return wheels
    } catch {
      // Preview and offline environments fall back to the local/default wheel below.
    }
  }
  const wheels = getStored<Wheel[]>(STORAGE_KEYS.wheels, [])
  if (wheels.length) {
    const normalized = wheels.map(normalizeWheel)
    setStored(STORAGE_KEYS.wheels, normalized)
    return normalized
  }
  const initial = [defaultWheel()]
  setStored(STORAGE_KEYS.wheels, initial)
  return initial
}

export const saveWheel = async (wheel: Wheel): Promise<Wheel> => {
  const normalizedWheel = normalizeWheel(wheel)
  if (USE_CLOUD && cloudSessionReady) {
    return callCloud<Wheel>('wheelMutation', { action: 'save', wheel: normalizedWheel })
  }
  const wheels = await listWheels()
  const next = { ...normalizedWheel, updatedAt: Date.now() }
  const index = wheels.findIndex((item) => item.id === next.id)
  if (index >= 0) wheels[index] = next
  else wheels.unshift(next)
  setStored(STORAGE_KEYS.wheels, wheels)
  return next
}

export const createWheel = async (name: string, items = defaultWheelItems()): Promise<Wheel> => {
  const now = Date.now()
  return saveWheel({ id: createId('wheel'), name, items, createdAt: now, updatedAt: now })
}

export const copyWheel = async (source: Wheel): Promise<Wheel> =>
  createWheel(
    `${source.name} 副本`,
    source.items.map((item) => ({ ...item, id: createId('item') })),
  )

export const deleteWheel = async (id: string): Promise<void> => {
  if (USE_CLOUD && cloudSessionReady) {
    await callCloud('wheelMutation', { action: 'delete', id })
    return
  }
  const wheels = (await listWheels()).filter((wheel) => wheel.id !== id)
  setStored(STORAGE_KEYS.wheels, wheels.length ? wheels : [defaultWheel()])
}

export const clearAllRecords = async (): Promise<void> => {
  if (USE_CLOUD) {
    await establishCloudSession()
    await callCloud('accountMutation', { action: 'clearRecords' })
    wx.removeStorageSync(STORAGE_KEYS.records)
    wx.removeStorageSync(STORAGE_KEYS.recordDraft)
    return
  }
  await deleteLocalFiles((await listRecords()).map((record) => record.photoPath))
  setStored(STORAGE_KEYS.records, [])
}

export const deleteAccount = async (): Promise<void> => {
  const profile = getStored<UserProfile | null>(STORAGE_KEYS.profile, null)
  const records = getStored<DrinkRecord[]>(STORAGE_KEYS.records, [])
  if (USE_CLOUD) {
    await establishCloudSession(false)
    await callCloud('accountMutation', { action: 'deleteAccount' })
  }
  await deleteLocalFiles([profile?.avatarUrl, ...records.map((record) => record.photoPath)])
  Object.values(STORAGE_KEYS).forEach((key) => wx.removeStorageSync(key))
  recordSessionReady = false
  cloudSessionReady = false
  cloudLoginPromise = null
}

export const uploadRecordPhoto = async (tempFilePath: string): Promise<string> => {
  if (!USE_CLOUD || !cloudSessionReady) {
    return new Promise<string>((resolve, reject) => {
      wx.getFileSystemManager().saveFile({
        tempFilePath,
        success: (result) => resolve(result.savedFilePath),
        fail: reject,
      })
    })
  }
  const profile = await ensureProfile()
  const cloudPath = `record-photos/${profile.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
  const result = await wx.cloud.uploadFile({ cloudPath, filePath: tempFilePath })
  return result.fileID
}
