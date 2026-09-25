const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async () => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) throw new Error('登录状态无效')
    const response = await cloud.openapi.wxacode.getUnlimited({
      scene: 'map',
      page: 'pages/map/index',
      checkPath: false,
      envVersion: process.env.MINIPROGRAM_ENV_VERSION || 'release',
      width: 280,
    })
    if (!response.buffer) throw new Error('小程序码生成失败')
    return { ok: true, data: { base64: response.buffer.toString('base64') } }
  } catch (error) {
    return { ok: false, message: error.message || '小程序码生成失败' }
  }
}
