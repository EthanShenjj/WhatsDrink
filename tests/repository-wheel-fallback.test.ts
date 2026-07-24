import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('wheel repository fallback', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns and stores the default wheel when the cloud query fails', async () => {
    const storage = new Map<string, unknown>()

    ;(globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      cloud: {
        database: () => ({
          collection: () => ({
            where: () => ({
              orderBy: () => ({
                get: () => Promise.reject(new Error('cloud environment unavailable')),
              }),
            }),
          }),
        }),
      },
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    } as unknown as WechatMiniprogram.Wx

    const { listWheels } = await import('../miniprogram/services/repository')
    const wheels = await listWheels()

    expect(wheels).toHaveLength(1)
    expect(wheels[0].name).toBe('今天喝什么咖啡')
    expect(wheels[0].items).toHaveLength(5)
    expect(storage.get('whatsdrink:wheels')).toEqual(wheels)
  })
})
