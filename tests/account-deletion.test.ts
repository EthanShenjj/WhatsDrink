import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('account deletion cloud mutation', () => {
  it('removes personal collections and detaches retained payment orders', () => {
    const script = String.raw`
const Module = require('module')
const collections = {
  user_profiles: [{ _id: 'profile-1', _openid: 'user-1', avatarUrl: '' }],
  footprints: [{ _id: 'footprint-1', _openid: 'user-1', photos: [] }],
  travel_plans: [{ _id: 'plan-1', _openid: 'user-1' }],
  time_capsules: [{ _id: 'capsule-1', _openid: 'user-1', photos: [] }],
  reminder_subscriptions: [{ _id: 'reminder-1', _openid: 'user-1' }],
  product_events: [{ _id: 'event-1', _openid: 'user-1' }],
  user_entitlements: [{ _id: 'entitlement-1', _openid: 'user-1' }],
  payment_orders: [{ _id: 'order-1', _openid: 'user-1', status: 'fulfilled' }],
}
const db = {
  collection(name) {
    return {
      where(query) {
        let offset = 0
        let limit = 100
        const result = {
          skip(value) { offset = value; return result },
          limit(value) { limit = value; return result },
          async get() {
            return { data: collections[name].filter((row) => row._openid === query._openid).slice(offset, offset + limit) }
          },
        }
        return result
      },
      doc(id) {
        return {
          async remove() { collections[name] = collections[name].filter((row) => row._id !== id) },
          async update({ data }) { Object.assign(collections[name].find((row) => row._id === id), data) },
        }
      },
    }
  },
}
const cloud = {
  DYNAMIC_CURRENT_ENV: 'test',
  init() {},
  database() { return db },
  getWXContext() { return { OPENID: 'user-1' } },
  async deleteFile() { return {} },
}
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return cloud
  return originalLoad(request, parent, isMain)
}
const { main } = require('./cloudfunctions/accountMutation/index.js')
main({ action: 'deleteAccount' })
  .then((result) => process.stdout.write(JSON.stringify({ result, collections })))
  .catch((error) => { console.error(error); process.exit(1) })
`
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    const { result, collections } = JSON.parse(output) as {
      result: { ok: boolean }
      collections: Record<string, Array<Record<string, unknown>>>
    }
    expect(result.ok).toBe(true)
    for (const name of ['user_profiles', 'footprints', 'travel_plans', 'time_capsules', 'reminder_subscriptions', 'product_events', 'user_entitlements']) {
      expect(collections[name]).toEqual([])
    }
    expect(collections.payment_orders).toHaveLength(1)
    expect(collections.payment_orders[0].accountDeletedAt).toEqual(expect.any(Number))
  })
})
