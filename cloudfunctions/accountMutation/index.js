const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DEFAULT_NICKNAME = '拾光者'
const GROWTH_COLORS = new Set(['journey', 'explore', 'discover', 'highlight', 'companion', 'dawn'])

const text = (value, max = 80) => String(value || '').trim().slice(0, max)

const cleanGrowth = (value) => {
  const growth = value && typeof value === 'object' ? value : {}
  return {
    ...(Number.isFinite(growth.trialStartedAt) ? { trialStartedAt: growth.trialStartedAt } : {}),
    ...(Number.isFinite(growth.plusUntil) ? { plusUntil: growth.plusUntil } : {}),
    ...(GROWTH_COLORS.has(growth.lockedColorId) ? { lockedColorId: growth.lockedColorId } : {}),
    ...(GROWTH_COLORS.has(growth.iconColorId) ? { iconColorId: growth.iconColorId } : {}),
    viewedMonthlyReports: Array.isArray(growth.viewedMonthlyReports)
      ? growth.viewedMonthlyReports.filter((item) => /^\d{4}-\d{2}$/.test(item)).slice(-24)
      : [],
  }
}

const profileForClient = (openid, profile) => ({
  id: openid,
  nickname: profile.nickname || DEFAULT_NICKNAME,
  avatarUrl: profile.avatarUrl || '',
  growth: cleanGrowth(profile.growth),
  createdAt: profile.createdAt,
  updatedAt: profile.updatedAt,
})

const isOwnedCloudFile = (path, openid) =>
  typeof path === 'string' && path.startsWith('cloud://') && path.includes(`/${openid}/`)

const deleteCloudFiles = async (paths, openid) => {
  const cloudPaths = (paths || []).filter((path) => isOwnedCloudFile(path, openid))
  for (let i = 0; i < cloudPaths.length; i += 50) {
    await cloud.deleteFile({ fileList: cloudPaths.slice(i, i + 50) }).catch(() => undefined)
  }
}

const drainCollection = async (name, openid, onItem) => {
  const collection = db.collection(name)
  let page = []
  do {
    page = (await collection.where({ _openid: openid }).limit(100).get()).data
    for (const item of page) {
      if (onItem) await onItem(item)
      await collection.doc(item._id).remove()
    }
  } while (page.length === 100)
}

const clearAllForUser = async (openid) => {
  const files = []

  await drainCollection('footprints', openid, (fp) => {
    if (Array.isArray(fp.photos)) files.push(...fp.photos)
  })

  await drainCollection('travel_plans', openid)

  await drainCollection('time_capsules', openid, (cap) => {
    if (Array.isArray(cap.photos)) files.push(...cap.photos)
  })

  if (files.length) await deleteCloudFiles(files, openid)
}

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) throw new Error('登录状态无效')

    if (event.action === 'saveProfile') {
      const collection = db.collection('user_profiles')
      const existing = await collection.where({ _openid: OPENID }).limit(1).get()
      const now = Date.now()
      const avatarUrl = text(event.patch && event.patch.avatarUrl, 500)
      if (avatarUrl && !isOwnedCloudFile(avatarUrl, OPENID)) {
        throw new Error('头像必须来自当前用户的云存储目录')
      }
      const profile = {
        _openid: OPENID,
        nickname: text(event.patch && event.patch.nickname, 20) || DEFAULT_NICKNAME,
        avatarUrl,
        growth: cleanGrowth(existing.data[0] && existing.data[0].growth),
        createdAt: existing.data[0] ? existing.data[0].createdAt : now,
        updatedAt: now,
      }
      if (existing.data[0]) {
        await collection.doc(existing.data[0]._id).set({ data: profile })
      } else {
        await collection.add({ data: profile })
      }
      const previousAvatar = existing.data[0] && existing.data[0].avatarUrl
      if (
        previousAvatar &&
        previousAvatar !== profile.avatarUrl &&
        isOwnedCloudFile(previousAvatar, OPENID)
      ) {
        await deleteCloudFiles([previousAvatar], OPENID)
      }
      return { ok: true, data: profileForClient(OPENID, profile) }
    }

    if (event.action === 'saveGrowthPreferences' || event.action === 'startGrowthTrial') {
      const collection = db.collection('user_profiles')
      const existing = await collection.where({ _openid: OPENID }).limit(1).get()
      const now = Date.now()
      const previous = existing.data[0] || {
        _openid: OPENID,
        nickname: DEFAULT_NICKNAME,
        avatarUrl: '',
        createdAt: now,
      }
      const growth = cleanGrowth(previous.growth)
      if (event.action === 'startGrowthTrial' && !growth.trialStartedAt) {
        growth.trialStartedAt = now
        growth.plusUntil = now + 7 * 86400000
      }
      if (event.action === 'saveGrowthPreferences') {
        const patch = event.patch && typeof event.patch === 'object' ? event.patch : {}
        if (Object.prototype.hasOwnProperty.call(patch, 'lockedColorId')) {
          if (GROWTH_COLORS.has(patch.lockedColorId)) growth.lockedColorId = patch.lockedColorId
          else delete growth.lockedColorId
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'iconColorId')) {
          if (GROWTH_COLORS.has(patch.iconColorId)) growth.iconColorId = patch.iconColorId
          else delete growth.iconColorId
        }
        if (Array.isArray(patch.viewedMonthlyReports)) {
          growth.viewedMonthlyReports = cleanGrowth({ viewedMonthlyReports: patch.viewedMonthlyReports }).viewedMonthlyReports
        }
      }
      const profile = { ...previous, growth, updatedAt: now }
      delete profile._id
      if (existing.data[0]) await collection.doc(existing.data[0]._id).set({ data: profile })
      else await collection.add({ data: profile })
      return { ok: true, data: profileForClient(OPENID, profile) }
    }

    if (event.action === 'clearAll') {
      await clearAllForUser(OPENID)
      return { ok: true, data: null }
    }

    if (event.action === 'deleteAccount') {
      const profiles = await db
        .collection('user_profiles')
        .where({ _openid: OPENID })
        .limit(10)
        .get()
      await clearAllForUser(OPENID)

      const avatarFiles = profiles.data
        .map((p) => p.avatarUrl)
        .filter((path) => isOwnedCloudFile(path, OPENID))
      if (avatarFiles.length) await deleteCloudFiles(avatarFiles, OPENID)

      await drainCollection('reminder_subscriptions', OPENID).catch(() => undefined)

      await Promise.all(
        profiles.data.map((profile) =>
          db.collection('user_profiles').doc(profile._id).remove(),
        ),
      )
      return { ok: true, data: null }
    }

    throw new Error('不支持的操作')
  } catch (error) {
    return { ok: false, message: error.message || '账号操作失败' }
  }
}
