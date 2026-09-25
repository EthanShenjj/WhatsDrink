const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const plans = db.collection('travel_plans')
const footprints = db.collection('footprints')

const STATUSES = new Set(['planning', 'ongoing', 'completed'])

const text = (value, max = 80) => String(value || '').trim().slice(0, max)

const validId = (value, fieldName = '计划 ID') => {
  const id = text(value, 100)
  if (id && !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`${fieldName}不合法`)
  return id
}

const optionalNumber = (value, min, max) => {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  if (!Number.isFinite(number) || number < min || number > max) throw new Error('数值字段不合法')
  return number
}

const optionalText = (value, max = 80) => {
  const trimmed = text(value, max)
  return trimmed || undefined
}

const sanitizeStringArray = (value, max = 30, itemMax = 100) => {
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

const sanitizeDayPlan = (item, days, allowedPoiIds) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('每日计划不合法')
  const day = Number(item.day)
  if (!Number.isInteger(day) || day < 1 || day > days) throw new Error('每日计划天数不合法')
  const poiIds = sanitizeStringArray(item.poiIds, 50, 100).map((id) => validId(id, '想去足迹 ID'))
  if (poiIds.some((id) => !allowedPoiIds.has(id))) throw new Error('每日计划引用了未加入计划的地点')
  const plan = {
    day,
    poiIds,
  }
  const note = text(item.note, 500)
  if (note) plan.note = note
  return plan
}

const sanitizePlan = (input, openid, existingCreatedAt, now = Date.now()) => {
  if (!openid) throw new Error('登录状态无效')
  if (!input) throw new Error('旅行计划内容不能为空')
  const title = text(input.title, 60)
  if (!title) throw new Error('标题不能为空')
  const city = text(input.city, 40)
  if (!city) throw new Error('城市不能为空')
  const days = optionalNumber(input.days, 1, 365)
  if (days === undefined) throw new Error('旅行天数不合法')
  const poiIds = sanitizeStringArray(input.poiIds, 200, 100).map((id) => validId(id, '想去足迹 ID'))
  const allowedPoiIds = new Set(poiIds)
  const dayPlans = input.dayPlans === undefined || input.dayPlans === null
    ? []
    : (() => {
        if (!Array.isArray(input.dayPlans)) throw new Error('每日计划字段不合法')
        if (input.dayPlans.length > 365) throw new Error('每日计划最多允许 365 天')
        const result = input.dayPlans.map((item) => sanitizeDayPlan(item, days, allowedPoiIds))
        if (new Set(result.map((item) => item.day)).size !== result.length) {
          throw new Error('每日计划天数不能重复')
        }
        return result
      })()
  if (input.status && !STATUSES.has(input.status)) throw new Error('旅行计划状态不合法')
  return {
    _openid: openid,
    title,
    city,
    days,
    preferences: sanitizeStringArray(input.preferences, 30, 30),
    poiIds,
    dayPlans,
    status: STATUSES.has(input.status) ? input.status : 'planning',
    createdAt: existingCreatedAt || now,
    updatedAt: now,
  }
}

const ownedPlan = async (id, openid) => {
  const response = await plans.doc(id).get()
  const plan = response.data
  if (!plan || plan._openid !== openid) {
    throw new Error('旅行计划不存在或无权操作')
  }
  return plan
}

const publicPlan = (plan, id) => {
  const { _openid, _id, ...data } = plan
  return { ...data, id: id || _id, userId: _openid }
}

const listOwned = async (openid) => {
  const result = []
  let offset = 0
  while (true) {
    const page = (
      await plans
        .where({ _openid: openid })
        .orderBy('updatedAt', 'desc')
        .skip(offset)
        .limit(100)
        .get()
    ).data
    result.push(...page.map((item) => publicPlan(item)))
    if (page.length < 100) break
    offset += page.length
  }
  return result
}

const assertOwnedWishlistPoiIds = async (poiIds, openid) => {
  if (!poiIds.length) return
  for (let index = 0; index < poiIds.length; index += 20) {
    const batch = poiIds.slice(index, index + 20)
    const response = await footprints
      .where({ _id: db.command.in(batch), _openid: openid, status: 'wishlist' })
      .limit(20)
      .get()
    if (response.data.length !== batch.length) {
      throw new Error('旅行计划只能引用当前用户的想去足迹')
    }
  }
}

const idFromClient = (openid, clientId) =>
  `plan_${crypto.createHash('sha256').update(`${openid}:${clientId}`).digest('hex').slice(0, 40)}`

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) throw new Error('登录状态无效')
    const action = event.action

    if (action === 'list') {
      return { ok: true, data: await listOwned(OPENID) }
    }

    if (action === 'create') {
      const input = event.plan || {}
      const clientId = validId(input.id)
      if (!clientId) throw new Error('计划 ID 不能为空')
      const id = idFromClient(OPENID, clientId)
      const data = sanitizePlan(input, OPENID)
      await assertOwnedWishlistPoiIds(data.poiIds, OPENID)
      const conflict = await plans.where({ _id: id }).limit(1).get()
      if (conflict.data.length) {
        const existing = conflict.data[0]
        if (existing._openid === OPENID) return { ok: true, data: publicPlan(existing) }
        throw new Error('计划已存在，不能覆盖')
      }
      await plans.doc(id).set({ data })
      return { ok: true, data: publicPlan(data, id) }
    }

    if (action === 'update') {
      const id = validId(event.plan && event.plan.id)
      if (!id) throw new Error('计划 ID 不能为空')
      const existing = await ownedPlan(id, OPENID)
      const data = sanitizePlan(event.plan, OPENID, existing.createdAt)
      await assertOwnedWishlistPoiIds(data.poiIds, OPENID)
      await plans.doc(id).set({ data })
      return { ok: true, data: publicPlan(data, id) }
    }

    if (action === 'delete') {
      const id = validId(event.id)
      if (!id) throw new Error('计划 ID 不能为空')
      await ownedPlan(id, OPENID)
      await plans.doc(id).remove()
      return { ok: true, data: null }
    }

    throw new Error('不支持的操作')
  } catch (error) {
    return { ok: false, message: error.message || '旅行计划操作失败' }
  }
}
