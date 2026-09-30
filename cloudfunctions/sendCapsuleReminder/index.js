const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const capsules = db.collection('time_capsules')

const todayString = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

// 订阅消息 time 字段要求中文日期格式（如 2026年9月26日），否则发送报 47003
const formatDateCN = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  if (!match) return String(value || '')
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`
}

const templateFields = () => ({
  title: String(process.env.CAPSULE_TITLE_FIELD || 'thing1').trim(),
  date: String(process.env.CAPSULE_DATE_FIELD || 'time2').trim(),
  note: String(process.env.CAPSULE_NOTE_FIELD || 'thing3').trim(),
})

const sendSubscription = async (capsule) => {
  const templateId = String(process.env.CAPSULE_TEMPLATE_ID || '').trim()
  if (!templateId || capsule.subscriptionId !== templateId) {
    console.warn('[sendCapsuleReminder] 胶囊授权模板与发送模板不一致', capsule._id)
    return false
  }
  const page = process.env.CAPSULE_PAGE || 'pages/time-capsule/index'
  // 体验版/开发版调试提醒时，在云函数环境变量里把 CAPSULE_MINIPROGRAM_STATE 设为 developer 或 trial
  const miniprogramState = process.env.CAPSULE_MINIPROGRAM_STATE
  const fields = templateFields()
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: capsule._openid,
      templateId,
      page,
      data: {
        [fields.title]: { value: String(capsule.title || '时间胶囊').slice(0, 20) },
        [fields.date]: { value: formatDateCN(capsule.unlockDate || todayString()) },
        [fields.note]: { value: '你的时间胶囊已解锁，快来看看吧' },
      },
      ...(miniprogramState ? { miniprogramState } : {}),
    })
    return true
  } catch (error) {
    // 订阅失败会静默降级（用户拒收、订阅额度耗尽等），但把错误码留下便于排查模板配置问题
    console.warn(
      '[sendCapsuleReminder] subscribeMessage.send failed',
      'errCode:', error.errCode,
      'errMsg:', error.errMsg || error.message,
      'capsuleId:', capsule._id,
    )
    return false
  }
}

const recordDelivery = async (capsule) => {
  const sent = await sendSubscription(capsule)
  const now = Date.now()
  await capsules.doc(capsule._id).update({
    data: sent
      ? { reminderSentAt: now, updatedAt: now }
      : { reminderFailedAt: now, updatedAt: now },
  })
  return sent
}

exports.main = async () => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (OPENID) throw new Error('该函数只允许定时触发器调用')
    const today = todayString()
    let unlocked = 0
    let notified = 0
    let failed = 0
    // Unlocking and notification are separate: opening the capsule page may
    // unlock a due capsule before this scheduled function runs.
    while (true) {
      const response = await capsules
        .where({ unlockDate: db.command.lte(today), status: 'locked' })
        .limit(100)
        .get()
      const page = response.data
      if (!page.length) break
      for (const capsule of page) {
        const now = Date.now()
        const claim = await capsules.where({ _id: capsule._id, status: 'locked' }).update({
          data: {
            status: 'unlocked',
            unlockedAt: now,
            updatedAt: now,
          },
        })
        if (!claim.stats || claim.stats.updated !== 1) continue
        unlocked++
      }
    }

    // Keep accepted subscriptions queued until the matching server template is configured.
    const templateId = String(process.env.CAPSULE_TEMPLATE_ID || '').trim()
    if (!templateId) {
      return { ok: true, data: { unlocked, notified, failed } }
    }
    const fields = Object.values(templateFields())
    if (fields.some((field) => !field) || new Set(fields).size !== fields.length) {
      throw new Error('订阅模板字段配置不合法')
    }
    // Claimed rows leave this result set, so querying from the first page
    // avoids skipping records as reminders are processed.
    while (true) {
      const response = await capsules
        .where({
          unlockDate: db.command.lte(today),
          subscriptionId: templateId,
          reminderAttemptedAt: db.command.exists(false),
        })
        .limit(100)
        .get()
      const page = response.data
      if (!page.length) break
      for (const capsule of page) {
        const now = Date.now()
        const claim = await capsules.where({
          _id: capsule._id,
          reminderAttemptedAt: db.command.exists(false),
        }).update({
          data: { reminderAttemptedAt: now, reminderAttempts: 1, updatedAt: now },
        })
        if (!claim.stats || claim.stats.updated !== 1) continue
        const sent = await recordDelivery(capsule)
        if (sent) notified++
        else failed++
      }
    }

    // A send can fail transiently or the function can stop after claiming a
    // reminder. Retry on a later run, never more than three total attempts.
    const retryBefore = Date.now() - 12 * 60 * 60 * 1000
    while (true) {
      const response = await capsules
        .where({
          unlockDate: db.command.lte(today),
          subscriptionId: templateId,
          reminderAttemptedAt: db.command.lte(retryBefore),
          reminderSentAt: db.command.exists(false),
          reminderTerminalAt: db.command.exists(false),
        })
        .limit(100)
        .get()
      const page = response.data
      if (!page.length) break
      for (const capsule of page) {
        const attempts = Number(capsule.reminderAttempts) || 1
        const now = Date.now()
        const condition = {
          _id: capsule._id,
          reminderAttemptedAt: db.command.lte(retryBefore),
          reminderSentAt: db.command.exists(false),
          reminderTerminalAt: db.command.exists(false),
        }
        if (attempts >= 3) {
          await capsules.where(condition).update({
            data: { reminderTerminalAt: now, updatedAt: now },
          })
          continue
        }
        const claim = await capsules.where(condition).update({
          data: { reminderAttemptedAt: now, reminderAttempts: attempts + 1, updatedAt: now },
        })
        if (!claim.stats || claim.stats.updated !== 1) continue
        const sent = await recordDelivery(capsule)
        if (sent) notified++
        else failed++
      }
    }
    return { ok: true, data: { unlocked, notified, failed } }
  } catch (error) {
    return { ok: false, message: error.message || '时间胶囊提醒发送失败' }
  }
}
