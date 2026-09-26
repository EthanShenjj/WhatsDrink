const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const capsules = db.collection('time_capsules')
const footprints = db.collection('footprints')

const STATUSES = new Set(['locked', 'unlocked'])
const FREE_CAPSULE_LIMIT = 3

const text = (value, max = 80) => String(value || '').trim().slice(0, max)

const validId = (value, fieldName = '胶囊 ID') => {
  const id = text(value, 100)
  if (id && !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`${fieldName}不合法`)
  return id
}

const optionalText = (value, max = 80) => {
  const trimmed = text(value, max)
  return trimmed || undefined
}

const sanitizeStringArray = (value, max = 30, itemMax = 500) => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('数组字段不合法')
  if (value.length > max) throw new Error(`数组字段最多允许 ${max} 项`)
  const seen = new Set()
  const result = []
  for (const item of value) {
    if (typeof item !== 'string') throw new Error('数组字段仅允许字符串')
    const trimmed = text(item, itemMax)
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      result.push(trimmed)
    }
  }
  return result
}

const pad2 = (value) => String(value).padStart(2, '0')
const todayKey = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

const dateValue = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('解锁日期格式不合法')
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error('解锁日期不合法')
  }
  return value
}

const sanitizePhotos = (value, openid) => {
  const photos = sanitizeStringArray(value, 9, 500)
  if (
    photos.some(
      (path) => !path.startsWith('cloud://') || !path.includes(`/${openid}/`),
    )
  ) {
    throw new Error('照片必须来自当前用户的云存储目录')
  }
  return photos
}

const sanitizeCapsule = (input, openid, existing, now = Date.now()) => {
  if (!openid) throw new Error('登录状态无效')
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('时间胶囊内容不能为空')
  }
  const title = text(input.title, 60)
  if (!title) throw new Error('标题不能为空')
  const unlockDate = dateValue(input.unlockDate)
  const status = existing && existing.status === 'unlocked' ? 'unlocked' : 'locked'
  if (status === 'locked' && unlockDate < todayKey(new Date(now))) {
    throw new Error('未解锁胶囊的解锁日期不能早于今天')
  }
  const data = {
    _openid: openid,
    title,
    footprintId: validId(input.footprintId, '足迹 ID') || undefined,
    text: optionalText(input.text, 2000),
    photos: sanitizePhotos(input.photos, openid),
    unlockDate,
    status,
    subscriptionId: optionalText(input.subscriptionId, 100),
    createdAt: existing && existing.createdAt ? existing.createdAt : now,
    updatedAt: now,
  }
  if (status === 'unlocked' && existing.unlockedAt) data.unlockedAt = existing.unlockedAt
  return data
}

const ownedCapsule = async (id, openid) => {
  const response = await capsules.doc(id).get()
  const capsule = response.data
  if (!capsule || capsule._openid !== openid) {
    throw new Error('时间胶囊不存在或无权操作')
  }
  return capsule
}

const publicCapsule = (capsule, id) => {
  const { _openid, _id, ...data } = capsule
  return { ...data, id: id || _id, userId: _openid }
}

const deleteCloudFiles = async (paths, openid) => {
  const cloudPaths = (paths || []).filter(
    (path) => path && path.startsWith('cloud://') && path.includes(`/${openid}/`),
  )
  for (let i = 0; i < cloudPaths.length; i += 50) {
    await cloud.deleteFile({ fileList: cloudPaths.slice(i, i + 50) }).catch(() => undefined)
  }
}

const listOwned = async (openid) => {
  const result = []
  let offset = 0
  while (true) {
    const page = (
      await capsules
        .where({ _openid: openid })
        .orderBy('unlockDate', 'asc')
        .skip(offset)
        .limit(100)
        .get()
    ).data
    result.push(...page.map((item) => publicCapsule(item)))
    if (page.length < 100) break
    offset += page.length
  }
  return result
}

const assertOwnedFootprint = async (id, openid) => {
  if (!id) return
  const response = await footprints.where({ _id: id, _openid: openid }).limit(1).get()
  if (!response.data.length) throw new Error('时间胶囊只能引用当前用户的足迹')
}

const idFromClient = (openid, clientId) =>
  `capsule_${crypto.createHash('sha256').update(`${openid}:${clientId}`).digest('hex').slice(0, 40)}`

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) throw new Error('登录状态无效')
    const action = event.action

    if (action === 'list') {
      return { ok: true, data: await listOwned(OPENID) }
    }

    if (action === 'create') {
      const input = event.capsule || {}
      const clientId = validId(input.id)
      if (!clientId) throw new Error('胶囊 ID 不能为空')
      const id = idFromClient(OPENID, clientId)
      const conflict = await capsules.where({ _id: id }).limit(1).get()
      if (conflict.data.length) {
        const existing = conflict.data[0]
        if (existing._openid === OPENID) return { ok: true, data: publicCapsule(existing) }
        throw new Error('胶囊已存在，不能覆盖')
      }
      const [profileResult, capsuleCount] = await Promise.all([
        db.collection('user_profiles').where({ _openid: OPENID }).limit(1).get(),
        capsules.where({ _openid: OPENID }).count(),
      ])
      const plusUntil = Number(profileResult.data[0]?.growth?.plusUntil) || 0
      if (capsuleCount.total >= FREE_CAPSULE_LIMIT && plusUntil <= Date.now()) {
        throw new Error('免费版最多可创建 3 个时光胶囊，开通拾光+ 后不限数量')
      }
      const data = sanitizeCapsule(input, OPENID)
      await assertOwnedFootprint(data.footprintId, OPENID)
      await capsules.doc(id).set({ data })
      return { ok: true, data: publicCapsule(data, id) }
    }

    if (action === 'update') {
      const id = validId(event.capsule && event.capsule.id)
      if (!id) throw new Error('胶囊 ID 不能为空')
      const existing = await ownedCapsule(id, OPENID)
      const data = sanitizeCapsule(event.capsule, OPENID, existing)
      await assertOwnedFootprint(data.footprintId, OPENID)
      await capsules.doc(id).set({ data })
      const removedPhotos = (existing.photos || []).filter(
        (p) => !(data.photos || []).includes(p),
      )
      if (removedPhotos.length) await deleteCloudFiles(removedPhotos, OPENID)
      return { ok: true, data: publicCapsule(data, id) }
    }

    if (action === 'delete') {
      const id = validId(event.id)
      if (!id) throw new Error('胶囊 ID 不能为空')
      const existing = await ownedCapsule(id, OPENID)
      await capsules.doc(id).remove()
      if (existing.photos && existing.photos.length) {
        await deleteCloudFiles(existing.photos, OPENID)
      }
      return { ok: true, data: null }
    }

    if (action === 'unlock') {
      const id = validId(event.id)
      if (!id) throw new Error('胶囊 ID 不能为空')
      const existing = await ownedCapsule(id, OPENID)
      if (existing.status === 'unlocked') {
        return { ok: true, data: publicCapsule(existing, id) }
      }
      if (existing.unlockDate > todayKey()) throw new Error('时间胶囊尚未到解锁日期')
      const now = Date.now()
      const update = {
        status: 'unlocked',
        unlockedAt: now,
        updatedAt: now,
      }
      await capsules.doc(id).update({ data: update })
      return { ok: true, data: publicCapsule({ ...existing, ...update }, id) }
    }

    throw new Error('不支持的操作')
  } catch (error) {
    return { ok: false, message: error.message || '时间胶囊操作失败' }
  }
}
