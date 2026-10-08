const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const allowed = new Set([
  'first_open', 'city_picker_opened', 'city_saved', 'province_card_opened',
  'place_added', 'old_record_opened', 'album_saved',
  'membership_page_viewed', 'membership_plus_selected', 'membership_pro_selected',
  'membership_benefits_viewed', 'membership_purchase_started',
  'membership_entitlement_activated', 'growth_history_opened', 'growth_annual_opened',
])

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) throw new Error('登录状态无效')
    const events = event.events
    if (!Array.isArray(events) || events.length > 30) throw new Error('事件数量不合法')
    const now = Date.now()
    const rows = events.map((item) => {
      if (!item || typeof item !== 'object' || !allowed.has(item.action)) throw new Error('事件类型不合法')
      if (typeof item.id !== 'string' || !/^\d{13}_[a-z0-9]{5,16}$/.test(item.id)) throw new Error('事件标识不合法')
      if (!Number.isFinite(item.at) || Math.abs(now - item.at) > 31 * 86_400_000) throw new Error('事件时间不合法')
      return { id: `evt_${crypto.createHash('sha256').update(`${OPENID}:${item.id}`).digest('hex').slice(0, 40)}`, _openid: OPENID, action: item.action, at: item.at }
    })
    for (const { id, ...data } of rows) await db.collection('product_events').doc(id).set({ data })
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error.message || '统计暂不可用' }
  }
}
