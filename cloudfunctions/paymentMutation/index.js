const crypto = require('crypto')
const https = require('https')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DAY = 86400000
const DEFAULT_NICKNAME = '拾光者'

const PRODUCTS = {
  plus_31d_v1: {
    productId: process.env.VIRTUAL_PAY_PRODUCT_PLUS_31D || 'plus_31d_v1',
    name: '拾光+ 31 天',
    priceFen: 600,
    days: 31,
  },
  plus_372d_v1: {
    productId: process.env.VIRTUAL_PAY_PRODUCT_PLUS_372D || 'plus_372d_v1',
    name: '拾光+ 372 天',
    priceFen: 4900,
    days: 372,
  },
}

const hmac = (key, value) =>
  crypto.createHmac('sha256', key).update(value, 'utf8').digest('hex')

let accessTokenCache = { value: '', expiresAt: 0 }

const postJson = (url, body) => new Promise((resolve, reject) => {
  const parsed = new URL(url)
  const request = https.request({
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    path: `${parsed.pathname}${parsed.search}`,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
    timeout: 8000,
  }, (response) => {
    let data = ''
    response.setEncoding('utf8')
    response.on('data', (chunk) => { data += chunk })
    response.on('end', () => {
      try {
        resolve(JSON.parse(data))
      } catch {
        reject(new Error('微信支付接口返回了无法解析的数据'))
      }
    })
  })
  request.on('timeout', () => request.destroy(new Error('微信支付接口请求超时')))
  request.on('error', reject)
  request.end(body)
})

const getAccessToken = async () => {
  const now = Date.now()
  if (accessTokenCache.value && accessTokenCache.expiresAt > now + 60000) {
    return accessTokenCache.value
  }
  const appid = String(process.env.WECHAT_APP_ID || '').trim()
  const secret = String(process.env.WECHAT_APP_SECRET || '').trim()
  if (!appid || !secret) throw new Error('查单兜底尚未配置 AppID 与 AppSecret')
  const body = JSON.stringify({
    grant_type: 'client_credential',
    appid,
    secret,
    force_refresh: false,
  })
  const result = await postJson('https://api.weixin.qq.com/cgi-bin/stable_token', body)
  if (!result.access_token) throw new Error(result.errmsg || '无法取得接口调用凭证')
  accessTokenCache = {
    value: result.access_token,
    expiresAt: now + Math.max(300, Number(result.expires_in) || 7200) * 1000,
  }
  return accessTokenCache.value
}

const createOutTradeNo = () =>
  `SG${Date.now()}${crypto.randomBytes(4).toString('hex')}`

const cleanGrowth = (growth) => {
  const source = growth && typeof growth === 'object' ? growth : {}
  return {
    ...(Number.isFinite(source.trialStartedAt) ? { trialStartedAt: source.trialStartedAt } : {}),
    ...(Number.isFinite(source.plusUntil) ? { plusUntil: source.plusUntil } : {}),
    ...(source.lockedColorId ? { lockedColorId: source.lockedColorId } : {}),
    ...(source.iconColorId ? { iconColorId: source.iconColorId } : {}),
    viewedMonthlyReports: Array.isArray(source.viewedMonthlyReports)
      ? source.viewedMonthlyReports
      : [],
  }
}

const profileForClient = (openid, profile, now = Date.now()) => ({
  id: openid,
  nickname: profile.nickname || DEFAULT_NICKNAME,
  avatarUrl: profile.avatarUrl || '',
  growth: cleanGrowth(profile.growth),
  createdAt: profile.createdAt || now,
  updatedAt: profile.updatedAt || now,
})

const orderForClient = (order) => ({
  id: order._id,
  outTradeNo: order.outTradeNo,
  ...(order.wxOrderId ? { wxOrderId: order.wxOrderId } : {}),
  productId: order.catalogProductId,
  productName: order.productName,
  amountFen: order.amountFen,
  status: order.status,
  ...(Number.isFinite(order.entitlementStartsAt)
    ? { entitlementStartsAt: order.entitlementStartsAt }
    : {}),
  ...(Number.isFinite(order.entitlementEndsAt)
    ? { entitlementEndsAt: order.entitlementEndsAt }
    : {}),
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
  ...(Number.isFinite(order.paidAt) ? { paidAt: order.paidAt } : {}),
  ...(Number.isFinite(order.fulfilledAt) ? { fulfilledAt: order.fulfilledAt } : {}),
  ...(Number.isFinite(order.refundedAt) ? { refundedAt: order.refundedAt } : {}),
})

const getProfile = async (openid) => {
  const result = await db.collection('user_profiles').where({ _openid: openid }).limit(1).get()
  if (result.data[0]) return result.data[0]
  const now = Date.now()
  const profile = {
    _openid: openid,
    nickname: DEFAULT_NICKNAME,
    avatarUrl: '',
    growth: { viewedMonthlyReports: [] },
    createdAt: now,
    updatedAt: now,
  }
  const added = await db.collection('user_profiles').add({ data: profile })
  return { ...profile, _id: added._id }
}

const getOwnedOrder = async (openid, outTradeNo) => {
  const result = await db.collection('payment_orders')
    .where({ _openid: openid, outTradeNo: String(outTradeNo || '') })
    .limit(1)
    .get()
  if (!result.data[0]) throw new Error('订单不存在')
  return result.data[0]
}

const fulfillPaidOrder = async (found, wxOrderId, paidAt = Date.now()) => {
  if (found.status === 'fulfilled') return found
  const profileResult = await db.collection('user_profiles')
    .where({ _openid: found._openid })
    .limit(1)
    .get()
  const profile = profileResult.data[0]
  if (!profile) throw new Error('用户资料不存在')
  const now = Date.now()

  await db.runTransaction(async (transaction) => {
    const freshOrder = (await transaction.collection('payment_orders').doc(found._id).get()).data
    if (freshOrder.status === 'fulfilled') return
    const freshProfile = (await transaction.collection('user_profiles').doc(profile._id).get()).data
    const currentUntil = Number(freshProfile.growth && freshProfile.growth.plusUntil) || 0
    const startsAt = Math.max(currentUntil, now)
    const endsAt = startsAt + Number(freshOrder.durationDays) * DAY
    await transaction.collection('payment_orders').doc(found._id).update({
      data: {
        wxOrderId,
        status: 'fulfilled',
        paidAt,
        fulfilledAt: now,
        entitlementStartsAt: startsAt,
        entitlementEndsAt: endsAt,
        updatedAt: now,
      },
    })
    await transaction.collection('user_entitlements').add({
      data: {
        _openid: found._openid,
        entitlementKey: 'plus',
        sourceOrderId: found.outTradeNo,
        startsAt,
        expiresAt: endsAt,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    })
    await transaction.collection('user_profiles').doc(profile._id).update({
      data: {
        growth: { ...(freshProfile.growth || {}), plusUntil: endsAt },
        updatedAt: now,
      },
    })
  })
  return getOwnedOrder(found._openid, found.outTradeNo)
}

const reconcileOrder = async (order) => {
  if (order.status !== 'pending') return order
  const now = Date.now()
  if (Number(order.lastQueriedAt) > now - 3000) return order
  await db.collection('payment_orders').doc(order._id).update({
    data: { lastQueriedAt: now, updatedAt: now },
  })
  const appKey = String(process.env.VIRTUAL_PAY_APP_KEY || '').trim()
  if (!appKey) throw new Error('查单兜底尚未配置 AppKey')
  const accessToken = await getAccessToken()
  const body = JSON.stringify({
    openid: order._openid,
    env: 0,
    order_id: order.outTradeNo,
  })
  const paySig = hmac(appKey, `/xpay/query_order&${body}`)
  const result = await postJson(
    `https://api.weixin.qq.com/xpay/query_order?access_token=${encodeURIComponent(accessToken)}&pay_sig=${paySig}`,
    body,
  )
  if (result.errcode) throw new Error(result.errmsg || '微信支付查单失败')
  const remote = result.order || {}
  if ((remote.status === 2 || remote.status === 4) && remote.paid_fee === order.amountFen) {
    return fulfillPaidOrder(
      order,
      String(remote.wx_order_id || ''),
      Number(remote.paid_time) > 0 ? Number(remote.paid_time) * 1000 : now,
    )
  }
  if (remote.status === 6) {
    await db.collection('payment_orders').doc(order._id).update({
      data: { status: 'failed', updatedAt: now },
    })
    return getOwnedOrder(order._openid, order.outTradeNo)
  }
  return { ...order, lastQueriedAt: now, updatedAt: now }
}

const exchangeSessionKey = async (code, expectedOpenid) => {
  if (!code) throw new Error('微信登录凭证不能为空')
  const result = await cloud.openapi.auth.code2Session({ jsCode: code })
  const errCode = result.errCode ?? result.errcode ?? 0
  if (errCode) throw new Error(result.errMsg || result.errmsg || '微信登录凭证无效')
  const openid = result.openid || result.openId
  const sessionKey = result.sessionKey || result.session_key
  if (!openid || openid !== expectedOpenid) throw new Error('登录用户与支付用户不一致')
  if (!sessionKey) throw new Error('未取得支付用户会话密钥')
  return sessionKey
}

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) throw new Error('登录状态无效')

    if (event.action === 'account') {
      let [profile, orders] = await Promise.all([
        getProfile(OPENID),
        db.collection('payment_orders')
          .where({ _openid: OPENID })
          .orderBy('createdAt', 'desc')
          .limit(30)
          .get(),
      ])
      const reconciledOrders = []
      let reconciliationCount = 0
      let refreshedProfile = false
      for (const order of orders.data) {
        if (order.status === 'pending' && reconciliationCount < 3) {
          reconciliationCount += 1
          try {
            const reconciled = await reconcileOrder(order)
            reconciledOrders.push(reconciled)
            if (reconciled.status === 'fulfilled') refreshedProfile = true
            continue
          } catch (error) {
            console.warn('[paymentMutation] account reconcile failed', error)
          }
        }
        reconciledOrders.push(order)
      }
      if (refreshedProfile) profile = await getProfile(OPENID)
      return {
        ok: true,
        data: {
          profile: profileForClient(OPENID, profile),
          orders: reconciledOrders.map(orderForClient),
        },
      }
    }

    if (event.action === 'getOrder') {
      let order = await getOwnedOrder(OPENID, event.outTradeNo)
      try {
        order = await reconcileOrder(order)
      } catch (error) {
        console.warn('[paymentMutation] reconcile failed', error)
      }
      return { ok: true, data: orderForClient(order) }
    }

    if (event.action === 'createOrder') {
      const catalogProductId = String(event.productId || '')
      const product = PRODUCTS[catalogProductId]
      if (!product) throw new Error('商品不存在或已下架')

      const offerId = String(process.env.VIRTUAL_PAY_OFFER_ID || '').trim()
      const appKey = String(process.env.VIRTUAL_PAY_APP_KEY || '').trim()
      if (!offerId || !appKey) throw new Error('虚拟支付尚未完成服务端配置')

      const sessionKey = await exchangeSessionKey(event.code, OPENID)
      const outTradeNo = createOutTradeNo()
      const now = Date.now()
      const attach = `sgj|${outTradeNo}|${catalogProductId}`
      const signData = JSON.stringify({
        offerId,
        buyQuantity: 1,
        env: 0,
        currencyType: 'CNY',
        productId: product.productId,
        goodsPrice: product.priceFen,
        outTradeNo,
        attach,
      })
      const order = {
        _openid: OPENID,
        outTradeNo,
        catalogProductId,
        platformProductId: product.productId,
        productName: product.name,
        amountFen: product.priceFen,
        durationDays: product.days,
        status: 'pending',
        attach,
        createdAt: now,
        updatedAt: now,
      }
      const added = await db.collection('payment_orders').add({ data: order })

      return {
        ok: true,
        data: {
          order: orderForClient({ ...order, _id: added._id }),
          payData: {
            mode: 'short_series_goods',
            signData,
            paySig: hmac(appKey, `requestVirtualPayment&${signData}`),
            signature: hmac(sessionKey, signData),
          },
        },
      }
    }

    throw new Error('不支持的支付操作')
  } catch (error) {
    return { ok: false, message: error.message || '支付服务暂时不可用' }
  }
}
