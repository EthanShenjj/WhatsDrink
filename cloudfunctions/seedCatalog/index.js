const cloud = require('wx-server-sdk')
const catalog = require('./catalog.json')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const upsert = async (collectionName, item) => {
  await db.collection(collectionName).doc(item.id).set({
    data: {
      ...item,
      public: true,
      updatedAt: Date.now(),
    },
  })
}

exports.main = async () => {
  try {
    const { OPENID } = cloud.getWXContext()
    const allowed = String(process.env.ADMIN_OPENIDS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    if (!OPENID || !allowed.includes(OPENID)) throw new Error('仅管理员可初始化饮品目录')

    for (const item of catalog.brands) await upsert('brands', item)
    for (const item of catalog.drinks) await upsert('drinks', item)
    return {
      ok: true,
      data: {
        brands: catalog.brands.length,
        drinks: catalog.drinks.length,
        version: catalog.version,
      },
    }
  } catch (error) {
    return { ok: false, message: error.message || '目录初始化失败' }
  }
}
