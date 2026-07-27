const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const text = (value, max = 80) => String(value || '').trim().slice(0, max)

const profileForClient = (openid, profile) => ({
  id: openid,
  nickname: profile.nickname || '饮品记录者',
  avatarUrl: profile.avatarUrl || '',
  createdAt: profile.createdAt,
  updatedAt: profile.updatedAt,
})

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) throw new Error('登录状态无效')

    if (event.action === 'saveProfile') {
      const collection = db.collection('user_profiles')
      const existing = await collection.where({ _openid: OPENID }).limit(1).get()
      const now = Date.now()
      const profile = {
        _openid: OPENID,
        nickname: text(event.patch && event.patch.nickname, 20) || '饮品记录者',
        avatarUrl: text(event.patch && event.patch.avatarUrl, 500),
        createdAt: existing.data[0] ? existing.data[0].createdAt : now,
        updatedAt: now,
      }
      if (existing.data[0]) await collection.doc(existing.data[0]._id).set({ data: profile })
      else await collection.add({ data: profile })
      const previousAvatar = existing.data[0] && existing.data[0].avatarUrl
      if (
        previousAvatar &&
        previousAvatar !== profile.avatarUrl &&
        String(previousAvatar).startsWith('cloud://')
      ) {
        await cloud.deleteFile({ fileList: [previousAvatar] }).catch(() => undefined)
      }
      return { ok: true, data: profileForClient(OPENID, profile) }
    }

    if (event.action === 'clearRecords' || event.action === 'deleteAccount') {
      const records = db.collection('drink_records')
      const files = []
      let profiles = { data: [] }
      if (event.action === 'deleteAccount') {
        profiles = await db.collection('user_profiles').where({ _openid: OPENID }).limit(10).get()
        files.push(
          ...profiles.data
            .map((profile) => profile.avatarUrl)
            .filter((path) => path && String(path).startsWith('cloud://')),
        )
      }
      let page = []
      do {
        page = (await records.where({ _openid: OPENID }).limit(100).get()).data
        files.push(
          ...page
            .map((record) => record.photoPath)
            .filter((path) => path && String(path).startsWith('cloud://')),
        )
        await Promise.all(page.map((record) => records.doc(record._id).remove()))
      } while (page.length === 100)

      if (files.length) {
        for (let index = 0; index < files.length; index += 50) {
          await cloud.deleteFile({ fileList: files.slice(index, index + 50) }).catch(() => undefined)
        }
      }

      if (event.action === 'deleteAccount') {
        const wheelCollection = db.collection('wheels')
        const subscriptionCollection = db.collection('reminder_subscriptions')
        let wheelPage = []
        do {
          wheelPage = (await wheelCollection.where({ _openid: OPENID }).limit(100).get()).data
          await Promise.all(wheelPage.map((wheel) => wheelCollection.doc(wheel._id).remove()))
        } while (wheelPage.length === 100)
        const subscriptions = await subscriptionCollection
          .where({ _openid: OPENID })
          .limit(100)
          .get()
        await Promise.all(
          [
            ...profiles.data.map((profile) =>
              db.collection('user_profiles').doc(profile._id).remove(),
            ),
            ...subscriptions.data.map((subscription) =>
              subscriptionCollection.doc(subscription._id).remove(),
            ),
          ],
        )
      }

      return { ok: true, data: null }
    }

    throw new Error('不支持的操作')
  } catch (error) {
    return { ok: false, message: error.message || '账号操作失败' }
  }
}
