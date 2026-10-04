const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DAY = 86400000

const response = (body, statusCode = 200) => ({
  statusCode,
  headers: { 'content-type': 'application/xml; charset=utf-8' },
  body,
})

const successXml = () =>
  '<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>'

const failureXml = (message) =>
  `<xml><ErrCode>1</ErrCode><ErrMsg><![CDATA[${String(message || 'failed').slice(0, 100)}]]></ErrMsg></xml>`

const getQuery = (event) => event.queryStringParameters || event.query || event || {}

const getBody = (event) => {
  const body = typeof event.body === 'string' ? event.body : ''
  return event.isBase64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body
}

const verifyMessageSignature = (event) => {
  const token = String(process.env.PAYMENT_MESSAGE_TOKEN || '').trim()
  if (!token) throw new Error('支付通知 Token 未配置')
  const query = getQuery(event)
  const timestamp = String(query.timestamp || '')
  const nonce = String(query.nonce || '')
  const provided = String(query.signature || '')
  if (!timestamp || !nonce || !provided) throw new Error('支付通知签名参数缺失')
  const expected = crypto
    .createHash('sha1')
    .update([token, timestamp, nonce].sort().join(''))
    .digest('hex')
  const left = Buffer.from(expected)
  const right = Buffer.from(provided)
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new Error('支付通知签名无效')
  }
}

const decodeXml = (value) => String(value || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")

const xmlValue = (xml, tag) => {
  const match = String(xml || '').match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? decodeXml(match[1]).trim() : ''
}

const findOrder = async (outTradeNo) => {
  const result = await db.collection('payment_orders')
    .where({ outTradeNo })
    .limit(1)
    .get()
  if (!result.data[0]) throw new Error('本地订单不存在')
  return result.data[0]
}

const fulfillOrder = async ({
  outTradeNo,
  openid,
  platformProductId,
  channelOrderId,
  wxpayTransactionId,
  paidAt,
}) => {
  const found = await findOrder(outTradeNo)
  if (found._openid !== openid) throw new Error('订单用户不一致')
  if (found.platformProductId !== platformProductId) throw new Error('订单商品不一致')
  if (found.status === 'fulfilled') {
    const metadata = {
      ...(!found.channelOrderId && channelOrderId ? { channelOrderId } : {}),
      ...(!found.wxpayTransactionId && wxpayTransactionId ? { wxpayTransactionId } : {}),
    }
    if (Object.keys(metadata).length) {
      await db.collection('payment_orders').doc(found._id).update({
        data: { ...metadata, updatedAt: Date.now() },
      })
    }
    return
  }
  if (found.status === 'refunded') throw new Error('退款订单不能发货')
  if (found.accountDeletedAt) {
    await db.collection('payment_orders').doc(found._id).update({
      data: {
        ...(channelOrderId ? { channelOrderId } : {}),
        ...(wxpayTransactionId ? { wxpayTransactionId } : {}),
        paidAt: Number.isFinite(paidAt) ? paidAt : Date.now(),
        refundReviewRequired: true,
        updatedAt: Date.now(),
      },
    })
    return
  }

  const profileResult = await db.collection('user_profiles')
    .where({ _openid: openid })
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
    const entitlementKey = freshOrder.entitlementKey === 'pro' ? 'pro' : 'plus'
    const currentPlusUntil = Number(freshProfile.growth && freshProfile.growth.plusUntil) || 0
    const currentProUntil = Number(freshProfile.growth && freshProfile.growth.proUntil) || 0
    const currentUntil = entitlementKey === 'pro' ? currentProUntil : currentPlusUntil
    const startsAt = Math.max(currentUntil, now)
    const endsAt = startsAt + Number(freshOrder.durationDays) * DAY
    const plusUntil = entitlementKey === 'pro' ? Math.max(currentPlusUntil, endsAt) : endsAt
    const plusGrantedDuration = Math.max(0, plusUntil - currentPlusUntil)
    const growth = {
      ...(freshProfile.growth || {}),
      plusUntil,
      ...(entitlementKey === 'pro' ? { proUntil: endsAt } : {}),
    }

    await transaction.collection('payment_orders').doc(found._id).update({
      data: {
        ...(channelOrderId ? { channelOrderId } : {}),
        ...(wxpayTransactionId ? { wxpayTransactionId } : {}),
        status: 'fulfilled',
        paidAt: Number.isFinite(paidAt) ? paidAt : now,
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
        _openid: openid,
        entitlementKey,
        sourceOrderId: outTradeNo,
        startsAt,
        expiresAt: endsAt,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    })
    await transaction.collection('user_profiles').doc(profile._id).update({
      data: { growth, updatedAt: now },
    })
  })
}

const refundOrder = async ({ outTradeNo, wxOrderId, refundFee }) => {
  const found = await findOrder(outTradeNo)
  if (found.status === 'refunded') return
  if (Number(refundFee) !== Number(found.amountFen)) {
    await db.collection('payment_orders').doc(found._id).update({
      data: {
        refundReviewRequired: true,
        refundedAmountFen: Number(refundFee) || 0,
        updatedAt: Date.now(),
      },
    })
    return
  }
  if (found.accountDeletedAt) {
    await db.collection('payment_orders').doc(found._id).update({
      data: { status: 'refunded', ...(wxOrderId ? { wxOrderId } : {}), refundedAt: Date.now(), updatedAt: Date.now() },
    })
    return
  }
  const profileResult = await db.collection('user_profiles')
    .where({ _openid: found._openid })
    .limit(1)
    .get()
  const profile = profileResult.data[0]
  if (!profile) throw new Error('用户资料不存在')
  const entitlementResult = await db.collection('user_entitlements')
    .where({ _openid: found._openid, sourceOrderId: outTradeNo })
    .limit(1)
    .get()
  const entitlement = entitlementResult.data[0]
  const now = Date.now()

  await db.runTransaction(async (transaction) => {
    const freshProfile = (await transaction.collection('user_profiles').doc(profile._id).get()).data
    const growth = { ...(freshProfile.growth || {}) }
    const entitlementKey = found.entitlementKey === 'pro' ? 'pro' : 'plus'
    const currentUntil = Number(growth.plusUntil) || 0
    const unusedFrom = Math.max(now, Number(found.entitlementStartsAt) || now)
    const unusedUntil = Number(found.entitlementEndsAt) || unusedFrom
    const unusedDuration = Math.max(0, unusedUntil - unusedFrom)
    if (entitlementKey === 'pro') {
      const currentProUntil = Number(growth.proUntil) || 0
      const plusGrantedDuration = Number.isFinite(found.plusGrantedDuration)
        ? Number(found.plusGrantedDuration)
        : unusedDuration
      growth.proUntil = Math.max(now, currentProUntil - unusedDuration)
      growth.plusUntil = Math.max(now, currentUntil - Math.min(unusedDuration, plusGrantedDuration))
    } else {
      growth.plusUntil = Math.max(now, currentUntil - unusedDuration)
    }

    await transaction.collection('payment_orders').doc(found._id).update({
      data: {
        ...(wxOrderId ? { wxOrderId } : {}),
        status: 'refunded',
        refundedAt: now,
        updatedAt: now,
      },
    })
    if (entitlement) {
      await transaction.collection('user_entitlements').doc(entitlement._id).update({
        data: { status: 'revoked', revokedAt: now, updatedAt: now },
      })
    }
    await transaction.collection('user_profiles').doc(profile._id).update({
      data: { growth, updatedAt: now },
    })
  })
}

exports.main = async (event) => {
  try {
    verifyMessageSignature(event)
    const query = getQuery(event)
    if (String(event.httpMethod || '').toUpperCase() === 'GET') {
      return response(String(query.echostr || ''))
    }

    const xml = getBody(event)
    const eventName = xmlValue(xml, 'Event')

    if (eventName === 'xpay_goods_deliver_notify') {
      const outTradeNo = xmlValue(xml, 'OutTradeNo')
      if (!outTradeNo) throw new Error('发货通知缺少业务订单号')
      const paidTimeSeconds = Number(xmlValue(xml, 'PaidTime'))
      await fulfillOrder({
        outTradeNo,
        openid: xmlValue(xml, 'OpenId'),
        platformProductId: xmlValue(xml, 'ProductId'),
        channelOrderId: xmlValue(xml, 'MchOrderNo'),
        wxpayTransactionId: xmlValue(xml, 'TransactionId'),
        paidAt: paidTimeSeconds > 0 ? paidTimeSeconds * 1000 : undefined,
      })
      return response(successXml())
    }

    if (eventName === 'xpay_refund_notify') {
      const retCode = xmlValue(xml, 'RetCode')
      if (!retCode) throw new Error('退款通知缺少结果码')
      if (Number(retCode) !== 0) return response(successXml())
      const outTradeNo = xmlValue(xml, 'MchOrderId')
      if (!outTradeNo) throw new Error('退款通知缺少商户订单号')
      await refundOrder({
        outTradeNo,
        wxOrderId: xmlValue(xml, 'WxOrderId'),
        refundFee: Number(xmlValue(xml, 'RefundFee')),
      })
      return response(successXml())
    }

    throw new Error('不支持的支付通知类型')
  } catch (error) {
    console.error('[paymentNotify]', error)
    return response(failureXml(error.message), 200)
  }
}
