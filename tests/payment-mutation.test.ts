import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const projectRoot = process.cwd()

const createOrderThroughHandler = (): Record<string, unknown> => {
  const script = String.raw`
const Module = require('module')
const { EventEmitter } = require('events')
const https = require('https')

let requestedUrl = ''
https.get = (url, _options, callback) => {
  requestedUrl = String(url)
  const request = new EventEmitter()
  request.destroy = (error) => request.emit('error', error)
  const response = new EventEmitter()
  response.setEncoding = () => undefined
  callback(response)
  process.nextTick(() => {
    response.emit('data', JSON.stringify({
      openid: 'user-1',
      session_key: 'test-session-key',
    }))
    response.emit('end')
  })
  return request
}

let savedOrder = null
const db = {
  collection(name) {
    if (name !== 'payment_orders') throw new Error('unexpected collection: ' + name)
    return {
      async add({ data }) {
        savedOrder = data
        return { _id: 'order-doc-1' }
      },
    }
  },
}
const cloud = {
  DYNAMIC_CURRENT_ENV: 'test',
  init() {},
  database() { return db },
  getWXContext() { return { OPENID: 'user-1' } },
}
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return cloud
  return originalLoad(request, parent, isMain)
}

Object.assign(process.env, {
  VIRTUAL_PAY_OFFER_ID: 'offer-1',
  VIRTUAL_PAY_APP_KEY: 'test-app-key',
  VIRTUAL_PAY_ENV: '0',
  WECHAT_APP_ID: 'wx-app-id',
  WECHAT_APP_SECRET: 'app-secret',
})

const { main } = require('./cloudfunctions/paymentMutation/index.js')
main({ action: 'createOrder', productId: 'plus_31d_v1', code: 'login-code-1' })
  .then((result) => process.stdout.write(JSON.stringify({ result, requestedUrl, savedOrder })))
  .catch((error) => {
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

describe('paymentMutation createOrder', () => {
  it('exchanges the fresh wx.login code through jscode2session before signing the order', () => {
    const replay = createOrderThroughHandler()
    const result = replay.result as {
      ok: boolean
      data: { payData: { signData: string } }
    }
    const requestedUrl = new URL(String(replay.requestedUrl))
    const signData = JSON.parse(result.data.payData.signData) as Record<string, unknown>

    expect(result.ok).toBe(true)
    expect(requestedUrl.pathname).toBe('/sns/jscode2session')
    expect(requestedUrl.searchParams.get('appid')).toBe('wx-app-id')
    expect(requestedUrl.searchParams.get('secret')).toBe('app-secret')
    expect(requestedUrl.searchParams.get('js_code')).toBe('login-code-1')
    expect(signData).toMatchObject({
      offerId: 'offer-1',
      productId: 'plus_31d_v1',
      goodsPrice: 600,
      env: 0,
    })
  })
})
