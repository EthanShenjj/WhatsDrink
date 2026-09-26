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

const sendSubscription = async (capsule) => {
  if (!capsule.subscriptionId || !process.env.CAPSULE_TEMPLATE_ID) return false
  const templateId = process.env.CAPSULE_TEMPLATE_ID
  const page = process.env.CAPSULE_PAGE || 'pages/time/index'
  // 体验版/开发版调试提醒时，在云函数环境变量里把 CAPSULE_MINIPROGRAM_STATE 设为 developer 或 trial
  const miniprogramState = process.env.CAPSULE_MINIPROGRAM_STATE
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: capsule._openid,
      templateId,
      page,
      data: {
        thing1: { value: String(capsule.title || '时间胶囊').slice(0, 20) },
        time2: { value: formatDateCN(capsule.unlockDate || todayString()) },
        thing3: { value: '你的时间胶囊已解锁，快来看看吧' },
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

exports.main = async () => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (OPENID) throw new Error('该函数只允许定时触发器调用')
    const today = todayString()
    let unlocked = 0
    let notified = 0
    let failed = 0
    // Re-query from the first page because claimed rows immediately leave the locked result set.
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
            reminderAttemptedAt: now,
            updatedAt: now,
          },
        })
        if (!claim.stats || claim.stats.updated !== 1) continue
        unlocked++
        const sent = await sendSubscription(capsule)
        await capsules.doc(capsule._id).update({
          data: sent
            ? { reminderSentAt: Date.now(), updatedAt: Date.now() }
            : { reminderFailedAt: Date.now(), updatedAt: Date.now() },
        })
        if (sent) notified++
        else failed++
      }
    }
    return { ok: true, data: { unlocked, notified, failed } }
  } catch (error) {
    return { ok: false, message: error.message || '时间胶囊提醒发送失败' }
  }
}
