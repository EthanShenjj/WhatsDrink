const cloud = require('wx-server-sdk')
const {
  applySubscriptionDecision,
  publicSubscriptionStatus,
  readSubscriptionConfig,
} = require('./subscription')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const subscriptions = db.collection('reminder_subscriptions')

const findSubscription = async (openid) => {
  const result = await subscriptions.where({ _openid: openid }).limit(1).get()
  return result.data[0]
}

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) throw new Error('登录状态无效')

    const config = readSubscriptionConfig()
    const existing = await findSubscription(OPENID)

    if (event.action === 'getStatus') {
      return {
        ok: true,
        data: publicSubscriptionStatus(existing, config.configured),
      }
    }

    if (event.action === 'getConfig') {
      return {
        ok: true,
        data: {
          ...publicSubscriptionStatus(existing, config.configured),
          templateId: config.templateId,
        },
      }
    }

    if (event.action === 'recordDecision') {
      if (!config.configured) throw new Error('订阅消息模板尚未配置')
      const next = {
        _openid: OPENID,
        ...applySubscriptionDecision(existing, event.decision, config),
      }
      if (existing) await subscriptions.doc(existing._id).set({ data: next })
      else await subscriptions.add({ data: next })
      return {
        ok: true,
        data: publicSubscriptionStatus(next, true),
      }
    }

    throw new Error('不支持的操作')
  } catch (error) {
    return {
      ok: false,
      message: error.message || '订阅提醒操作失败',
    }
  }
}
