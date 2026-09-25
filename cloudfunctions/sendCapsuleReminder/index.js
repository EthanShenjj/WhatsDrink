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

const sendSubscription = async (capsule) => {
  if (!capsule.subscriptionId || !process.env.CAPSULE_TEMPLATE_ID) return false
  const templateId = process.env.CAPSULE_TEMPLATE_ID
  const page = process.env.CAPSULE_PAGE || 'pages/time/index'
  // Template variables are placeholders until a real template is configured.
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: capsule._openid,
      templateId,
      page,
      data: {
        thing1: { value: String(capsule.title || '时间胶囊').slice(0, 20) },
        time2: { value: String(capsule.unlockDate || todayString()).slice(0, 20) },
        thing3: { value: '你的时间胶囊已解锁，快来看看吧' },
      },
    })
    return true
  } catch (error) {
    // Swallow subscription errors (e.g., user revoked subscription, expired template)
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
