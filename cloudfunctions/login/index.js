const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DEFAULT_NICKNAME = '拾光者'

exports.main = async () => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) throw new Error('无法识别当前微信用户')

    const collection = db.collection('user_profiles')
    const now = Date.now()
    const existing = await collection.where({ _openid: OPENID }).limit(1).get()
    const profile = existing.data[0]

    if (!profile) {
      await collection.add({
        data: {
          _openid: OPENID,
          nickname: DEFAULT_NICKNAME,
          avatarUrl: '',
          growth: { viewedMonthlyReports: [] },
          createdAt: now,
          updatedAt: now,
        },
      })
      return {
        ok: true,
        data: {
          id: OPENID,
          nickname: DEFAULT_NICKNAME,
          avatarUrl: '',
          growth: { viewedMonthlyReports: [] },
          createdAt: now,
          updatedAt: now,
        },
      }
    }

    // Migrate only the former product's untouched default profile label.
    const legacyDefault = profile.nickname === '饮品记录者' && !profile.avatarUrl
    if (legacyDefault) {
      await collection.doc(profile._id).update({ data: { nickname: DEFAULT_NICKNAME, updatedAt: now } })
    }

    return {
      ok: true,
      data: {
        id: OPENID,
        nickname: legacyDefault ? DEFAULT_NICKNAME : profile.nickname || DEFAULT_NICKNAME,
        avatarUrl: profile.avatarUrl || '',
        growth: profile.growth || { viewedMonthlyReports: [] },
        createdAt: profile.createdAt || now,
        updatedAt: legacyDefault ? now : profile.updatedAt || now,
      },
    }
  } catch (error) {
    return { ok: false, message: error.message || '登录失败' }
  }
}
