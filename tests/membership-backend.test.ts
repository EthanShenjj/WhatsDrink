import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const runCloudScenario = (script: string): Record<string, any> => JSON.parse(execFileSync(
  process.execPath,
  ['-e', script],
  { cwd: process.cwd(), encoding: 'utf8' },
))

describe('membership cloud enforcement', () => {
  it('never shortens paid Plus time when the trial endpoint is called', () => {
    const result = runCloudScenario(String.raw`
const Module = require('module')
const paidUntil = Date.now() + 30 * 86400000
const profile = { _id: 'profile-1', _openid: 'user-1', nickname: '', avatarUrl: '', growth: { plusUntil: paidUntil, viewedMonthlyReports: [] }, createdAt: 1, updatedAt: 1 }
const collection = {
  where() { return { limit() { return { async get() { return { data: [profile] } } } } } },
  doc() { return { async set({ data }) { Object.assign(profile, data) } } },
  async add() { throw new Error('unexpected add') },
}
const cloud = { DYNAMIC_CURRENT_ENV: 'test', init() {}, database() { return { collection() { return collection } } }, getWXContext() { return { OPENID: 'user-1' } } }
const originalLoad = Module._load
Module._load = function (request, parent, isMain) { if (request === 'wx-server-sdk') return cloud; return originalLoad(request, parent, isMain) }
require('./cloudfunctions/accountMutation/index.js').main({ action: 'startGrowthTrial' }).then((response) => {
  process.stdout.write(JSON.stringify({ response, paidUntil, savedUntil: profile.growth.plusUntil }))
})
`)

    expect(result.response.ok).toBe(true)
    expect(result.savedUntil).toBe(result.paidUntil)
  })

  it('allows a Pro-only profile to exceed the free capsule limit', () => {
    const result = runCloudScenario(String.raw`
const Module = require('module')
let saved = null
const profile = { growth: { proUntil: Date.now() + 30 * 86400000 } }
const capsules = {
  where(query) {
    return {
      limit() { return { async get() { return { data: query._id ? [] : [] } } } },
      async count() { return { total: 3 } },
    }
  },
  doc() { return { async set({ data }) { saved = data } } },
}
const profiles = { where() { return { limit() { return { async get() { return { data: [profile] } } } } } } }
const cloud = {
  DYNAMIC_CURRENT_ENV: 'test', init() {}, getWXContext() { return { OPENID: 'user-1' } },
  database() { return { collection(name) { if (name === 'time_capsules') return capsules; if (name === 'user_profiles') return profiles; return { where() { return { limit() { return { async get() { return { data: [] } } } } } } } } } },
  async deleteFile() {},
}
const originalLoad = Module._load
Module._load = function (request, parent, isMain) { if (request === 'wx-server-sdk') return cloud; return originalLoad(request, parent, isMain) }
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
require('./cloudfunctions/timeCapsuleMutation/index.js').main({ action: 'create', capsule: { id: 'client-1', title: 'Pro 胶囊', unlockDate: tomorrow, photos: [] } }).then((response) => {
  process.stdout.write(JSON.stringify({ response, saved: Boolean(saved) }))
})
`)

    expect(result.response.ok).toBe(true)
    expect(result.saved).toBe(true)
  })

  it('paginates visible payment orders and hides without deleting the order', () => {
    const result = runCloudScenario(String.raw`
const Module = require('module')
const orders = Array.from({ length: 12 }, (_, index) => ({
  _id: 'id-' + index, _openid: 'user-1', outTradeNo: 'order-' + index,
  catalogProductId: 'plus_31d_v1', productName: 'Plus 31 天', amountFen: 600,
  status: 'fulfilled', createdAt: 1000 - index, updatedAt: 1000 - index,
  ...(index === 11 ? { hiddenAt: 999 } : {}),
}))
const profile = { _id: 'profile-1', _openid: 'user-1', growth: {}, createdAt: 1, updatedAt: 1 }
const command = { gte: (value) => ({ op: 'gte', value }), exists: (value) => ({ op: 'exists', value }) }
const matches = (row, query) => Object.entries(query).every(([key, value]) => {
  if (value && value.op === 'gte') return row[key] >= value.value
  if (value && value.op === 'exists') return value.value ? key in row : !(key in row)
  return row[key] === value
})
const paymentCollection = {
  where(query) {
    let offset = 0; let limit = 100
    const chain = {
      orderBy() { return chain },
      skip(value) { offset = value; return chain },
      limit(value) { limit = value; return chain },
      async get() { return { data: orders.filter((row) => matches(row, query)).sort((a, b) => b.createdAt - a.createdAt).slice(offset, offset + limit) } },
      async count() { return { total: orders.filter((row) => matches(row, query)).length } },
    }
    return chain
  },
  doc(id) { return { async update({ data }) { Object.assign(orders.find((row) => row._id === id), data) } } },
}
const profileCollection = { where() { return { limit() { return { async get() { return { data: [profile] } } } } } } }
const cloud = {
  DYNAMIC_CURRENT_ENV: 'test', init() {}, getWXContext() { return { OPENID: 'user-1' } },
  database() { return { command, collection(name) { return name === 'payment_orders' ? paymentCollection : profileCollection } } },
}
const originalLoad = Module._load
Module._load = function (request, parent, isMain) { if (request === 'wx-server-sdk') return cloud; return originalLoad(request, parent, isMain) }
const fn = require('./cloudfunctions/paymentMutation/index.js')
Promise.resolve().then(async () => {
  const first = await fn.main({ action: 'listOrders', offset: 0, limit: 10 })
  const hidden = await fn.main({ action: 'hideOrder', outTradeNo: 'order-0' })
  const after = await fn.main({ action: 'listOrders', offset: 0, limit: 10 })
  process.stdout.write(JSON.stringify({ first, hidden, after, stored: orders.length, hiddenAt: orders[0].hiddenAt }))
})
`)

    expect(result.first.ok).toBe(true)
    expect(result.first.data.orders).toHaveLength(10)
    expect(result.first.data.total).toBe(11)
    expect(result.first.data.hasMore).toBe(true)
    expect(result.hidden.data.hidden).toBe(true)
    expect(result.after.data.total).toBe(10)
    expect(result.stored).toBe(12)
    expect(result.hiddenAt).toEqual(expect.any(Number))
  })
})
