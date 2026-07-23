const cloud = require('wx-server-sdk')
const { sanitizeWheelItems, text } = require('./validation')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const wheels = db.collection('wheels')

const publicWheel = (data, id) => {
  const { _openid, _id, ...wheel } = data
  return { ...wheel, id: id || _id }
}

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) throw new Error('登录状态无效')

    if (event.action === 'save') {
      const input = event.wheel || {}
      const id = text(input.id, 100)
      const name = text(input.name, 30)
      if (!id || !name) throw new Error('转盘名称不能为空')
      const existing = await wheels.doc(id).get().catch(() => ({ data: null }))
      if (existing.data && existing.data._openid !== OPENID) throw new Error('无权操作这个转盘')
      const now = Date.now()
      const data = {
        _openid: OPENID,
        name,
        items: sanitizeWheelItems(input.items),
        createdAt: (existing.data && existing.data.createdAt) || Number(input.createdAt) || now,
        updatedAt: now,
      }
      await wheels.doc(id).set({ data })
      return { ok: true, data: publicWheel(data, id) }
    }

    if (event.action === 'delete') {
      const id = text(event.id, 100)
      const existing = await wheels.doc(id).get()
      if (!existing.data || existing.data._openid !== OPENID) throw new Error('无权操作这个转盘')
      await wheels.doc(id).remove()
      return { ok: true, data: null }
    }

    throw new Error('不支持的操作')
  } catch (error) {
    return { ok: false, message: error.message || '转盘操作失败' }
  }
}
