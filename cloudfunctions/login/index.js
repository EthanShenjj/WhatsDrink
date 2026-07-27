const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, message: '无法识别当前微信用户' }

  const collection = db.collection('user_profiles')
  const now = Date.now()
  const wheelCollection = db.collection('wheels')
  const [existing, existingWheels] = await Promise.all([
    collection.where({ _openid: OPENID }).limit(1).get(),
    wheelCollection.where({ _openid: OPENID }).limit(1).get(),
  ])
  const setupTasks = []
  if (!existingWheels.data.length) {
    setupTasks.push(wheelCollection.add({
      data: {
        _openid: OPENID,
        name: '今天喝什么咖啡',
        items: [
          { id: 'luckin', label: '瑞幸', brandId: 'luckin', brandName: '瑞幸', category: 'coffee' },
          { id: 'starbucks', label: '星巴克', brandId: 'starbucks', brandName: '星巴克', category: 'coffee' },
          { id: 'manner', label: 'Manner', brandId: 'manner', brandName: 'Manner', category: 'coffee' },
          { id: 'tims', label: 'Tims', brandId: 'tims', brandName: 'Tims', category: 'coffee' },
          { id: 'mstand', label: 'M Stand', brandId: 'mstand', brandName: 'M Stand', category: 'coffee' }
        ],
        createdAt: now,
        updatedAt: now,
      },
    }))
  }

  const profile = existing.data[0]
  if (!profile) {
    setupTasks.push(collection.add({
      data: {
        _openid: OPENID,
        nickname: '饮品记录者',
        avatarUrl: '',
        createdAt: now,
        updatedAt: now,
      },
    }))
  }
  if (setupTasks.length) await Promise.all(setupTasks)

  if (!profile) {
    return {
      ok: true,
      data: {
        id: OPENID,
        nickname: '饮品记录者',
        avatarUrl: '',
        createdAt: now,
        updatedAt: now,
      },
    }
  }

  return {
    ok: true,
    data: {
      id: OPENID,
      nickname: profile.nickname || '饮品记录者',
      avatarUrl: profile.avatarUrl || '',
      createdAt: profile.createdAt || now,
      updatedAt: profile.updatedAt || now,
    },
  }
}
