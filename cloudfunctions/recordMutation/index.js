const cloud = require('wx-server-sdk')
const { sanitizeRecord, text } = require('./validation')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const records = db.collection('drink_records')

const ownedRecord = async (id, openid) => {
  const response = await records.doc(id).get()
  const record = response.data
  if (!record || record._openid !== openid) throw new Error('记录不存在或无权操作')
  return record
}

const publicRecord = (record, id) => {
  const { _openid, _id, ...data } = record
  return { ...data, id: id || _id }
}

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) throw new Error('登录状态无效')
    const action = event.action

    if (action === 'create') {
      const input = event.record || {}
      const requestId = text(input.clientRequestId, 100)
      if (requestId) {
        const duplicate = await records
          .where({ _openid: OPENID, clientRequestId: requestId })
          .limit(1)
          .get()
        if (duplicate.data.length) {
          return { ok: true, data: publicRecord(duplicate.data[0]) }
        }
      }
      const id = text(input.id, 100)
      const data = sanitizeRecord(input, OPENID)
      if (id) await records.doc(id).set({ data })
      else {
        const result = await records.add({ data })
        return { ok: true, data: publicRecord(data, result._id) }
      }
      return { ok: true, data: publicRecord(data, id) }
    }

    if (action === 'update') {
      const id = text(event.record && event.record.id, 100)
      const existing = await ownedRecord(id, OPENID)
      const data = sanitizeRecord(event.record, OPENID, existing.createdAt)
      await records.doc(id).set({ data })
      if (
        existing.photoPath &&
        existing.photoPath !== data.photoPath &&
        String(existing.photoPath).startsWith('cloud://')
      ) {
        await cloud.deleteFile({ fileList: [existing.photoPath] }).catch(() => undefined)
      }
      return { ok: true, data: publicRecord(data, id) }
    }

    if (action === 'delete') {
      const id = text(event.id, 100)
      const existing = await ownedRecord(id, OPENID)
      await records.doc(id).remove()
      if (existing.photoPath && String(existing.photoPath).startsWith('cloud://')) {
        await cloud.deleteFile({ fileList: [existing.photoPath] }).catch(() => undefined)
      }
      return { ok: true, data: null }
    }

    throw new Error('不支持的操作')
  } catch (error) {
    return { ok: false, message: error.message || '记录操作失败' }
  }
}
