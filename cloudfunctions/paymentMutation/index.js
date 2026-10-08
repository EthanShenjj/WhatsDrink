const crypto = require('crypto')
const https = require('https')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DAY = 86400000
const DEFAULT_NICKNAME = ''

const PRODUCTS = {
  plus_31d_v1: {
    productId: process.env.VIRTUAL_PAY_PRODUCT_PLUS_31D || 'plus_31d_v1',
    name: 'Plus 31 天',
    priceFen: 600,
    days: 31,
    entitlementKey: 'plus',
  },
  plus_372d_v1: {
    productId: process.env.VIRTUAL_PAY_PRODUCT_PLUS_372D || 'plus_372d_v1',
    name: 'Plus 372 天',
    priceFen: 4900,
    days: 372,
    entitlementKey: 'plus',
  },
  pro_372d_v1: {
    productId: process.env.VIRTUAL_PAY_PRODUCT_PRO_372D || 'pro_372d_v1',
    name: 'Pro 年卡',
    priceFen: 9900,
    days: 372,
    entitlementKey: 'pro',
  },
}

const hmac = (key, value) =>
  crypto.createHmac('sha256', key).update(value, 'utf8').digest('hex')

// 真机支付使用现网环境；沙箱仅用于开发者工具内调试，真机会被微信拒绝。
// AppKey 必须与 env 成对：1 + 沙箱 AppKey，0 + 现网 AppKey。
const virtualPayEnv = () => (String(process.env.VIRTUAL_PAY_ENV || '').trim() === '1' ? 1 : 0)

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

const getJson = (url) => new Promise((resolve, reject) => {
  const request = https.get(url, { timeout: 8000 }, (response) => {
    let data = ''
    response.setEncoding('utf8')
    response.on('data', (chunk) => { data += chunk })
    response.on('end', () => {
      try {
        resolve(JSON.parse(data))
      } catch {
        reject(new Error('微信登录接口返回了无法解析的数据'))
      }
    })
  })
  request.on('timeout', () => request.destroy(new Error('微信登录接口请求超时')))
  request.on('error', reject)
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
    ...(Number.isFinite(source.proUntil) ? { proUntil: source.proUntil } : {}),
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
  if (!result.data[0] || result.data[0].accountDeletedAt) throw new Error('订单不存在')
  return result.data[0]
}

const fulfillPaidOrder = async (found, wxOrderId, paidAt = Date.now()) => {
  if (found.accountDeletedAt) throw new Error('账号已注销，订单需人工处理')
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
    if (freshOrder.accountDeletedAt) throw new Error('账号已注销，订单需人工处理')
    if (freshOrder.status === 'fulfilled') return
    const freshProfile = (await transaction.collection('user_profiles').doc(profile._id).get()).data
    const growth = { ...(freshProfile.growth || {}) }
    const entitlementKey = freshOrder.entitlementKey === 'pro' ? 'pro' : 'plus'
    const currentPlusUntil = Number(growth.plusUntil) || 0
    const currentProUntil = Number(growth.proUntil) || 0
    const currentUntil = entitlementKey === 'pro' ? currentProUntil : currentPlusUntil
    const startsAt = Math.max(currentUntil, now)
    const endsAt = startsAt + Number(freshOrder.durationDays) * DAY
    const plusUntil = entitlementKey === 'pro' ? Math.max(currentPlusUntil, endsAt) : endsAt
    const plusGrantedDuration = Math.max(0, plusUntil - currentPlusUntil)
    growth.plusUntil = plusUntil
    if (entitlementKey === 'pro') growth.proUntil = endsAt
    await transaction.collection('payment_orders').doc(found._id).update({
      data: {
        wxOrderId,
        status: 'fulfilled',
        paidAt,
        fulfilledAt: now,
        entitlementStartsAt: startsAt,
        entitlementEndsAt: endsAt,
        entitlementKey,
        plusGrantedDuration,
        updatedAt: now,
      },
    })
    await transaction.collection('user_entitlements').add({
      data: {
        _openid: found._openid,
        entitlementKey,
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
        growth,
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
    env: virtualPayEnv(),
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

const membershipTemplateId = () => String(process.env.MEMBERSHIP_TEMPLATE_ID || '').trim()

// 到期提醒依赖一次性订阅授权：用户每次在会员页开启提醒会沉淀一条未使用的授权，
// 定时函数在临期窗口内消耗一条发送一条。同一用户同一模板最多保留 3 条待用授权。
const countReminderAuthorizations = async (openid, templateId) => {
  const result = await db.collection('reminder_subscriptions')
    .where({ _openid: openid, templateId, usedAt: db.command.exists(false) })
    .count()
  return Number(result.total) || 0
}

const saveReminderSubscription = async (openid, templateId, enabled) => {
  const serverTemplateId = membershipTemplateId()
  if (!serverTemplateId) throw new Error('到期提醒尚未开放')
  if (templateId !== serverTemplateId) throw new Error('提醒模板与当前服务端配置不一致')
  const collection = db.collection('reminder_subscriptions')
  if (!enabled) {
    const unused = await collection
      .where({ _openid: openid, templateId, usedAt: db.command.exists(false) })
      .limit(100)
      .get()
    for (const row of unused.data) {
      await collection.doc(row._id).remove().catch(() => undefined)
    }
    return { enabled: false, count: 0 }
  }
  const count = await countReminderAuthorizations(openid, templateId)
  if (count >= 3) return { enabled: true, count }
  const now = Date.now()
  await collection.add({
    data: {
      _openid: openid,
      templateId,
      kind: 'membership_expiry',
      createdAt: now,
      updatedAt: now,
    },
  })
  return { enabled: true, count: count + 1 }
}

const exchangeSessionKey = async (code, expectedOpenid) => {
  if (!code) throw new Error('微信登录凭证不能为空')
  const appid = String(process.env.WECHAT_APP_ID || '').trim()
  const secret = String(process.env.WECHAT_APP_SECRET || '').trim()
  if (!appid || !secret) throw new Error('支付登录尚未配置 AppID 与 AppSecret')
  const result = await getJson(
    `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(appid)}`
      + `&secret=${encodeURIComponent(secret)}`
      + `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`,
  )
  const errCode = Number(result.errcode || 0)
  if (errCode) throw new Error(result.errmsg || '微信登录凭证无效')
  const openid = result.openid
  const sessionKey = result.session_key
  if (!openid || openid !== expectedOpenid) throw new Error('登录用户与支付用户不一致')
  if (!sessionKey) throw new Error('未取得支付用户会话密钥')
  return sessionKey
}

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) throw new Error('登录状态无效')

    if (event.action === 'account') {
      const templateId = membershipTemplateId()
      const reconcilePending = event.reconcilePending === true
      let profile = await getProfile(OPENID)
      const accountCreatedAt = Number(profile.createdAt) || 0
      let [orders, fulfilledOrders, reminderAuthorizations] = await Promise.all([
        db.collection('payment_orders')
          .where({
            _openid: OPENID,
            createdAt: db.command.gte(accountCreatedAt),
            hiddenAt: db.command.exists(false),
          })
          .orderBy('createdAt', 'desc')
          .limit(3)
          .get(),
        db.collection('payment_orders')
          .where({
            _openid: OPENID,
            createdAt: db.command.gte(accountCreatedAt),
            status: 'fulfilled',
          })
          .count(),
        templateId
          ? countReminderAuthorizations(OPENID, templateId).catch(() => 0)
          : Promise.resolve(0),
      ])
      const reconciledOrders = []
      let reconciliationCount = 0
      let refreshedProfile = false
      for (const order of orders.data.filter((item) => !item.accountDeletedAt && item.createdAt >= accountCreatedAt)) {
        if (reconcilePending && order.status === 'pending' && reconciliationCount < 3) {
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
          orders: reconciledOrders
            .filter((order) => !order.hiddenAt)
            .slice(0, 3)
            .map(orderForClient),
          hasFulfilledOrder: fulfilledOrders.total > 0
            || reconciledOrders.some((order) => order.status === 'fulfilled'),
          ...(templateId ? { reminderTemplateId: templateId } : {}),
          reminderAuthorizations,
        },
      }
    }

    if (event.action === 'listOrders') {
      const profile = await getProfile(OPENID)
      const accountCreatedAt = Number(profile.createdAt) || 0
      const offset = Math.max(0, Math.floor(Number(event.offset) || 0))
      const limit = Math.min(20, Math.max(1, Math.floor(Number(event.limit) || 10)))
      const query = {
        _openid: OPENID,
        createdAt: db.command.gte(accountCreatedAt),
        hiddenAt: db.command.exists(false),
      }
      const [orders, count] = await Promise.all([
        db.collection('payment_orders')
          .where(query)
          .orderBy('createdAt', 'desc')
          .skip(offset)
          .limit(limit)
          .get(),
        db.collection('payment_orders').where(query).count(),
      ])
      const visibleOrders = orders.data.filter((order) => !order.accountDeletedAt)
      const nextOffset = offset + visibleOrders.length
      return {
        ok: true,
        data: {
          orders: visibleOrders.map(orderForClient),
          total: count.total,
          nextOffset,
          hasMore: nextOffset < count.total,
        },
      }
    }

    if (event.action === 'hideOrder') {
      const order = await getOwnedOrder(OPENID, event.outTradeNo)
      const now = Date.now()
      await db.collection('payment_orders').doc(order._id).update({
        data: { hiddenAt: now, updatedAt: now },
      })
      return { ok: true, data: { hidden: true } }
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
        env: virtualPayEnv(),
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
        entitlementKey: product.entitlementKey,
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

    if (event.action === 'saveReminderSubscription') {
      const data = await saveReminderSubscription(
        OPENID,
        String(event.templateId || ''),
        Boolean(event.enabled),
      )
      return { ok: true, data }
    }

    throw new Error('不支持的支付操作')
  } catch (error) {
    return { ok: false, message: error.message || '支付服务暂时不可用' }
  }
}
