const cloud = require('wx-server-sdk')
const {
  buildSendPayload,
  shanghaiDateKey,
  shouldSendReminder,
  wechatErrorCode,
} = require('./reminder')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const command = db.command
const subscriptions = db.collection('reminder_subscriptions')

const claimSubscription = async (subscription, dateKey) => {
  const result = await subscriptions
    .where({
      _id: subscription._id,
      enabled: true,
      remainingCount: command.gt(0),
      lastAttemptDate: command.neq(dateKey),
    })
    .update({
      data: {
        lastAttemptDate: dateKey,
        updatedAt: Date.now(),
      },
    })
  return Number(result.stats && result.stats.updated) > 0
}

const sendOne = async (subscription, dateKey) => {
  if (!shouldSendReminder(subscription, dateKey)) return 'skipped'
  if (!(await claimSubscription(subscription, dateKey))) return 'skipped'

  try {
    await cloud.openapi.subscribeMessage.send(
      buildSendPayload({
        openid: subscription._openid,
        templateId: subscription.templateId,
        page: subscription.page || 'pages/home/index',
        data: subscription.messageData,
      }),
    )
    await subscriptions.doc(subscription._id).update({
      data: {
        remainingCount: command.inc(-1),
        lastSentDate: dateKey,
        lastError: '',
        updatedAt: Date.now(),
      },
    })
    return 'sent'
  } catch (error) {
    const code = wechatErrorCode(error)
    const data = {
      lastError: `${code || 'unknown'}:${String(error.errMsg || error.message || error)}`.slice(
        0,
        300,
      ),
      updatedAt: Date.now(),
    }
    if (code === 43101) {
      data.enabled = false
      data.remainingCount = 0
    }
    await subscriptions.doc(subscription._id).update({ data })
    return 'failed'
  }
}

exports.main = async () => {
  const dateKey = shanghaiDateKey()
  const summary = { dateKey, sent: 0, failed: 0, skipped: 0 }

  while (true) {
    const result = await subscriptions
      .where({
        enabled: true,
        remainingCount: command.gt(0),
        lastAttemptDate: command.neq(dateKey),
      })
      .limit(100)
      .get()
    if (!result.data.length) break

    const outcomes = await Promise.all(
      result.data.map((subscription) => sendOne(subscription, dateKey)),
    )
    outcomes.forEach((outcome) => {
      summary[outcome] += 1
    })
    if (result.data.length < 100) break
  }

  console.log('daily drink reminder summary', summary)
  return { ok: true, data: summary }
}
