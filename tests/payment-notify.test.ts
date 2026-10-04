import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const projectRoot = process.cwd()

const replayPaymentNotifications = (accountDeleted = false): Record<string, unknown> => {
  const script = String.raw`
const Module = require('module')
const crypto = require('crypto')

const now = Date.now()
const state = {
  order: {
    _id: 'order-doc-1',
    _openid: 'user-1',
    outTradeNo: 'SG-ORDER-1',
    platformProductId: 'plus_31d_v1',
    amountFen: 600,
    durationDays: 31,
    entitlementKey: 'plus',
    status: 'pending',
    accountDeletedAt: ${accountDeleted ? 'now' : 'undefined'},
    createdAt: now,
    updatedAt: now,
  },
  profile: {
    _id: 'profile-doc-1',
    _openid: 'user-1',
    growth: { viewedMonthlyReports: [] },
  },
  entitlement: null,
}

const matches = (value, query) => Object.entries(query).every(([key, expected]) => value?.[key] === expected)
const rowsFor = (name, query) => {
  if (name === 'payment_orders') return matches(state.order, query) ? [state.order] : []
  if (name === 'user_profiles') return matches(state.profile, query) ? [state.profile] : []
  if (name === 'user_entitlements') return matches(state.entitlement, query) ? [state.entitlement] : []
  return []
}
const documentFor = (name) => name === 'payment_orders'
  ? state.order
  : name === 'user_profiles'
    ? state.profile
    : state.entitlement
const mergeDocument = (name, data) => {
  if (name === 'payment_orders') Object.assign(state.order, data)
  else if (name === 'user_profiles') Object.assign(state.profile, data)
  else if (state.entitlement) Object.assign(state.entitlement, data)
}
const collection = (name) => ({
  where(query) {
    return { limit() { return { async get() { return { data: rowsFor(name, query) } } } } }
  },
  doc() {
    return {
      async get() { return { data: documentFor(name) } },
      async update({ data }) { mergeDocument(name, data) },
    }
  },
  async add({ data }) {
    state.entitlement = { _id: 'entitlement-doc-1', ...data }
    return { _id: state.entitlement._id }
  },
})
const db = {
  collection,
  async runTransaction(callback) {
    return callback({ collection })
  },
}
const cloud = {
  DYNAMIC_CURRENT_ENV: 'test',
  init() {},
  database() { return db },
}
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return cloud
  return originalLoad(request, parent, isMain)
}

process.env.PAYMENT_MESSAGE_TOKEN = 'test-token'
const { main } = require('./cloudfunctions/paymentNotify/index.js')
const timestamp = '1700000000'
const nonce = 'nonce-1'
const signature = crypto.createHash('sha1')
  .update(['test-token', timestamp, nonce].sort().join(''))
  .digest('hex')
const event = (body) => ({
  httpMethod: 'POST',
  queryStringParameters: { timestamp, nonce, signature },
  body,
})

const deliverXml = '<xml>'
  + '<Event><![CDATA[xpay_goods_deliver_notify]]></Event>'
  + '<OpenId><![CDATA[user-1]]></OpenId>'
  + '<OutTradeNo><![CDATA[SG-ORDER-1]]></OutTradeNo>'
  + '<WeChatPayInfo><MchOrderNo><![CDATA[channel-order-123]]></MchOrderNo>'
  + '<TransactionId><![CDATA[wxpay-transaction-456]]></TransactionId></WeChatPayInfo>'
  + '<GoodsInfo><ProductId><![CDATA[plus_31d_v1]]></ProductId></GoodsInfo>'
  + '</xml>'
const refundXml = '<xml>'
  + '<Event><![CDATA[xpay_refund_notify]]></Event>'
  + '<RetCode>0</RetCode>'
  + '<MchOrderId><![CDATA[SG-ORDER-1]]></MchOrderId>'
  + '<WxOrderId><![CDATA[xpay-order-789]]></WxOrderId>'
  + '<RefundFee>600</RefundFee>'
  + '</xml>'

;(async () => {
  const delivery = await main(event(deliverXml))
  const refund = await main(event(refundXml))
  process.stdout.write(JSON.stringify({
    delivery: delivery.body,
    refund: refund.body,
    order: state.order,
    entitlement: state.entitlement,
  }))
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
`

  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  return JSON.parse(output) as Record<string, unknown>
}

describe('paymentNotify', () => {
  it('keeps post-deletion payments for refund review without restoring membership', () => {
    const result = replayPaymentNotifications(true)
    const order = result.order as Record<string, unknown>
    expect(result.delivery).toContain('<ErrCode>0</ErrCode>')
    expect(result.refund).toContain('<ErrCode>0</ErrCode>')
    expect(order).toMatchObject({ status: 'refunded', refundReviewRequired: true })
    expect(result.entitlement).toBeNull()
  })

  it('accepts a refund after fulfillment without confusing channel and XPay order IDs', () => {
    const result = replayPaymentNotifications()
    const order = result.order as Record<string, unknown>
    const entitlement = result.entitlement as Record<string, unknown>

    expect(result.delivery).toContain('<ErrCode>0</ErrCode>')
    expect(result.refund).toContain('<ErrCode>0</ErrCode>')
    expect(order).toMatchObject({
      status: 'refunded',
      wxOrderId: 'xpay-order-789',
      channelOrderId: 'channel-order-123',
      wxpayTransactionId: 'wxpay-transaction-456',
    })
    expect(entitlement.status).toBe('revoked')
  })
})
