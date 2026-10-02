const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DAY = 86400000

// 会员为一次性购买、不自动续费，续购闭环依赖到期提醒：
// 消费 reminder_subscriptions 里用户授权过的一次性订阅额度，在临期窗口内发送提醒。
// 授权额度来自会员页开关（paymentMutation.saveReminderSubscription）。

const remindWindowMs = () => {
  const days = Number(process.env.MEMBERSHIP_REMIND_DAYS)
  return (Number.isFinite(days) && days > 0 ? days : 3) * DAY
}

const templateFields = () => ({
  title: String(process.env.MEMBERSHIP_TITLE_FIELD || 'thing1').trim(),
  date: String(process.env.MEMBERSHIP_DATE_FIELD || 'time2').trim(),
  note: String(process.env.MEMBERSHIP_NOTE_FIELD || 'thing3').trim(),
})

// 订阅消息 time 字段要求中文日期格式（如 2026年10月3日），否则发送报 47003
const formatDateCN = (timestamp) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp))
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${Number(value.year)}年${Number(value.month)}月${Number(value.day)}日`
}

const entitlementTarget = (profile) => {
  const growth = profile && typeof profile.growth === 'object' ? profile.growth : {}
  const plusUntil = Number(growth.plusUntil) || 0
  const proUntil = Number(growth.proUntil) || 0
  const until = Math.max(plusUntil, proUntil)
  if (!until) return null
  // Pro 到期日不低于 Plus（发货时 Pro 会同时延长 Plus），按更高等级称呼会员
  const isPro = proUntil >= plusUntil
  return { until, isPro }
}

const sendReminder = async (openid, target) => {
  const templateId = String(process.env.MEMBERSHIP_TEMPLATE_ID || '').trim()
  const page = process.env.MEMBERSHIP_PAGE || 'pages/membership/index'
  // 体验版/开发版调试提醒时，在云函数环境变量里把 MEMBERSHIP_MINIPROGRAM_STATE 设为 developer 或 trial
  const miniprogramState = process.env.MEMBERSHIP_MINIPROGRAM_STATE
  const fields = templateFields()
  const expired = target.until < Date.now()
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId,
      page,
      data: {
        [fields.title]: { value: target.isPro ? 'Pro 会员' : 'Plus 会员' },
        [fields.date]: { value: formatDateCN(target.until) },
        [fields.note]: {
          value: expired ? '会员已到期，续购可从现在起算' : '会员即将到期，续购可顺延剩余时长',
        },
      },
      ...(miniprogramState ? { miniprogramState } : {}),
    })
    return true
  } catch (error) {
    console.warn(
      '[sendMembershipReminder] subscribeMessage.send failed',
      'errCode:', error.errCode,
      'errMsg:', error.errMsg || error.message,
      'openid:', openid,
    )
    return false
  }
}

const state = { sent: 0, failed: 0, skipped: 0, terminal: 0, profiles: new Map() }

const getProfile = async (openid) => {
  if (!state.profiles.has(openid)) {
    const result = await db.collection('user_profiles')
      .where({ _openid: openid })
      .limit(1)
      .get()
    state.profiles.set(openid, result.data[0] || null)
  }
  return state.profiles.get(openid)
}

const claimRow = async (row) => {
  const now = Date.now()
  const claim = await db.collection('reminder_subscriptions')
    .where({ _id: row._id, usedAt: db.command.exists(false), reminderTerminalAt: db.command.exists(false) })
    .update({
      data: {
        reminderAttemptedAt: now,
        reminderAttempts: db.command.inc(1),
        updatedAt: now,
      },
    })
  return Boolean(claim.stats && claim.stats.updated === 1)
}

const processRow = async (row) => {
  const fresh = (await db.collection('reminder_subscriptions').doc(row._id).get()).data
  if (!fresh || fresh.usedAt || fresh.reminderTerminalAt) return
  const profile = await getProfile(fresh._openid)
  const target = entitlementTarget(profile)
  // 未开通或过期超过一天的授权不消耗，留到用户下一次开通后再提醒
  if (!target || target.until < Date.now() - DAY || target.until > Date.now() + remindWindowMs()) {
    state.skipped++
    return
  }
  // 同一到期日只发一条：多授权或跨天重跑时不再重复打扰
  const alreadyReminded = await db.collection('reminder_subscriptions')
    .where({
      _openid: fresh._openid,
      templateId: fresh.templateId,
      targetUntil: target.until,
      usedAt: db.command.exists(true),
    })
    .limit(1)
    .get()
  if (alreadyReminded.data.length) {
    state.skipped++
    return
  }
  if (!(await claimRow(fresh))) return
  const sent = await sendReminder(fresh._openid, target)
  if (sent) {
    await db.collection('reminder_subscriptions').doc(fresh._id).update({
      data: { usedAt: Date.now(), targetUntil: target.until, updatedAt: Date.now() },
    })
    state.sent++
  } else {
    // 授权未被消费，12 小时后的重试或第三次失败后的终止标记会接手
    state.failed++
  }
}

const collectRowIds = async (condition) => {
  const collection = db.collection('reminder_subscriptions')
  const ids = []
  let offset = 0
  while (true) {
    const page = await collection.where(condition).orderBy('_id', 'asc').skip(offset).limit(100).get()
    for (const row of page.data) ids.push(row._id)
    if (page.data.length < 100) return ids
    offset += 100
  }
}

exports.main = async () => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (OPENID) throw new Error('该函数只允许定时触发器调用')
    const templateId = String(process.env.MEMBERSHIP_TEMPLATE_ID || '').trim()
    if (!templateId) {
      return { ok: true, data: { sent: 0, failed: 0, skipped: 0, terminal: 0, reason: 'template-not-configured' } }
    }
    const fields = Object.values(templateFields())
    if (fields.some((field) => !field) || new Set(fields).size !== fields.length) {
      throw new Error('到期提醒模板字段配置不合法')
    }

    const freshIds = await collectRowIds({
      templateId,
      usedAt: db.command.exists(false),
      reminderAttemptedAt: db.command.exists(false),
    })
    for (const id of freshIds) {
      await processRow({ _id: id })
    }

    // 发送可能瞬时失败或函数在发送前中断：12 小时后重试，总共不超过 3 次
    const retryBefore = Date.now() - 12 * 60 * 60 * 1000
    const retryIds = await collectRowIds({
      templateId,
      usedAt: db.command.exists(false),
      reminderAttemptedAt: db.command.lte(retryBefore),
      reminderTerminalAt: db.command.exists(false),
    })
    const collection = db.collection('reminder_subscriptions')
    for (const id of retryIds) {
      const row = (await collection.doc(id).get()).data
      if (!row || row.usedAt || row.reminderTerminalAt) continue
      if ((Number(row.reminderAttempts) || 0) >= 3) {
        const marked = await collection.where({
          _id: id,
          reminderTerminalAt: db.command.exists(false),
        }).update({ data: { reminderTerminalAt: Date.now(), updatedAt: Date.now() } })
        if (marked.stats && marked.stats.updated === 1) state.terminal++
        continue
      }
      await processRow({ _id: id })
    }

    return {
      ok: true,
      data: { sent: state.sent, failed: state.failed, skipped: state.skipped, terminal: state.terminal },
    }
  } catch (error) {
    return { ok: false, message: error.message || '会员到期提醒发送失败' }
  }
}
