import { beforeEach, describe, expect, it, vi } from 'vitest'

let cloudReady: boolean
let store: Record<string, unknown>
const callFunction = vi.fn()
vi.mock('../miniprogram/services/repository', () => ({ hasCloudAccess: () => cloudReady }))

beforeEach(() => {
  vi.resetModules()
  cloudReady = false
  store = {}
  callFunction.mockReset().mockResolvedValue({ result: { ok: true } })
  ;(globalThis as any).wx = {
    getStorageSync: (key: string) => store[key],
    setStorageSync: (key: string, value: unknown) => { store[key] = value },
    cloud: { callFunction },
  }
})

describe('minimal product events', () => {
  it('queues an action offline and later sends only its ID, name, and time', async () => {
    const { trackProductEvent, flushProductEvents } = await import('../miniprogram/services/product-events')
    trackProductEvent('city_saved')
    expect(callFunction).not.toHaveBeenCalled()
    cloudReady = true
    await flushProductEvents()
    const payload = callFunction.mock.calls[0][0]
    expect(payload.name).toBe('productEvents')
    expect(payload.data.events).toHaveLength(1)
    expect(Object.keys(payload.data.events[0]).sort()).toEqual(['action', 'at', 'id'])
    expect(payload.data.events[0].action).toBe('city_saved')
    expect(store['sgj:product-events-pending']).toEqual([])
  })

  it('retains events after a failed upload and tracks first open once', async () => {
    const { trackFirstOpen, flushProductEvents } = await import('../miniprogram/services/product-events')
    trackFirstOpen()
    trackFirstOpen()
    expect(store['sgj:product-events-pending']).toHaveLength(1)
    cloudReady = true
    callFunction.mockRejectedValueOnce(new Error('network'))
    await flushProductEvents()
    expect(store['sgj:product-events-pending']).toHaveLength(1)
    await flushProductEvents()
    expect(store['sgj:product-events-pending']).toEqual([])
  })
})
