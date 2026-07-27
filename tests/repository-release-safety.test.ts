import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrinkRecord, UserProfile, Wheel } from '../miniprogram/domain/types'

const profile: UserProfile = {
  id: 'cloud-user',
  nickname: '饮品记录者',
  avatarUrl: '',
  createdAt: 1,
  updatedAt: 1,
}

const localRecord: DrinkRecord = {
  id: 'local-record',
  category: 'coffee',
  brandName: '楼下咖啡',
  drinkName: '拿铁',
  size: '中杯',
  temperature: '热',
  sweetness: '无糖',
  calorieSource: 'user',
  note: '',
  consumedAt: 123,
  clientRequestId: 'request-local',
  createdAt: 123,
  updatedAt: 123,
}

const localWheel: Wheel = {
  id: 'local-wheel',
  name: '本地转盘',
  items: [
    { id: 'one', label: 'A' },
    { id: 'two', label: 'B' },
  ],
  createdAt: 123,
  updatedAt: 123,
}

describe('repository release safety', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('retries cloud login after a transient failure', async () => {
    const storage = new Map<string, unknown>()
    let loginFunctionCalls = 0

    ;(globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      login: ({ success }: WechatMiniprogram.LoginOption) =>
        success?.({ code: 'code', errMsg: 'login:ok' }),
      cloud: {
        callFunction: async ({ name }: { name: string }) => {
          if (name !== 'login') throw new Error(`unexpected function ${name}`)
          loginFunctionCalls += 1
          if (loginFunctionCalls === 1) throw new Error('temporary outage')
          return { result: { ok: true, data: profile } }
        },
      },
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      getFileSystemManager: () => ({
        unlink: ({ success }: { success?: () => void }) => success?.(),
      }),
    } as unknown as WechatMiniprogram.Wx

    const repository = await import('../miniprogram/services/repository')

    expect((await repository.loginForRecordAccess()).id).toBe('local-user')
    expect((await repository.loginForRecordAccess()).id).toBe('cloud-user')
    expect(loginFunctionCalls).toBe(2)
  })

  it('migrates local records and wheels before switching to cloud data', async () => {
    const storage = new Map<string, unknown>([
      ['whatsdrink:records', [localRecord]],
      ['whatsdrink:wheels', [localWheel]],
    ])
    const calls: Array<{ name: string; data: Record<string, unknown> }> = []

    ;(globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      login: ({ success }: WechatMiniprogram.LoginOption) =>
        success?.({ code: 'code', errMsg: 'login:ok' }),
      cloud: {
        callFunction: async ({
          name,
          data,
        }: {
          name: string
          data: Record<string, unknown>
        }) => {
          calls.push({ name, data })
          if (name === 'login') return { result: { ok: true, data: profile } }
          return { result: { ok: true, data: data.record || data.wheel || null } }
        },
        database: () => ({
          collection: () => ({
            where: () => ({
              orderBy: () => ({
                skip: () => ({
                  limit: () => ({
                    get: async () => ({ data: [] }),
                  }),
                }),
              }),
            }),
          }),
        }),
      },
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
    } as unknown as WechatMiniprogram.Wx

    const repository = await import('../miniprogram/services/repository')
    await repository.loginForRecordAccess()

    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'recordMutation',
          data: expect.objectContaining({ action: 'create', record: localRecord }),
        }),
        expect.objectContaining({
          name: 'wheelMutation',
          data: expect.objectContaining({ action: 'save', wheel: localWheel }),
        }),
      ]),
    )
    expect(storage.has('whatsdrink:records')).toBe(false)
    expect(storage.has('whatsdrink:wheels')).toBe(false)
    expect(storage.get('whatsdrink:profile')).toEqual(profile)
  })

  it('paginates the complete cloud record history', async () => {
    const requestedOffsets: number[] = []
    const records = Array.from({ length: 45 }, (_, index) => ({
      ...localRecord,
      id: `record-${index}`,
      _id: `record-${index}`,
      consumedAt: 1000 - index,
    }))

    ;(globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      login: ({ success }: WechatMiniprogram.LoginOption) =>
        success?.({ code: 'code', errMsg: 'login:ok' }),
      cloud: {
        callFunction: async () => ({ result: { ok: true, data: profile } }),
        database: () => ({
          collection: () => ({
            where: () => ({
              orderBy: () => ({
                skip: (offset: number) => {
                  requestedOffsets.push(offset)
                  return {
                    limit: (limit: number) => ({
                      get: async () => ({
                        data: records.slice(offset, offset + limit),
                      }),
                    }),
                  }
                },
              }),
            }),
          }),
        }),
      },
      getStorageSync: () => undefined,
      setStorageSync: () => undefined,
      removeStorageSync: () => undefined,
    } as unknown as WechatMiniprogram.Wx

    const repository = await import('../miniprogram/services/repository')
    await repository.loginForRecordAccess()

    expect(await repository.listRecords()).toHaveLength(45)
    expect(requestedOffsets).toEqual([0, 20, 40])
  })

  it('paginates all cloud wheels instead of truncating the list', async () => {
    const requestedOffsets: number[] = []
    const wheels = Array.from({ length: 45 }, (_, index) => ({
      ...localWheel,
      id: `wheel-${index}`,
      _id: `wheel-${index}`,
      name: `转盘 ${index}`,
      updatedAt: 1000 - index,
    }))

    ;(globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      login: ({ success }: WechatMiniprogram.LoginOption) =>
        success?.({ code: 'code', errMsg: 'login:ok' }),
      cloud: {
        callFunction: async () => ({ result: { ok: true, data: profile } }),
        database: () => ({
          collection: () => ({
            where: () => ({
              orderBy: () => ({
                skip: (offset: number) => {
                  requestedOffsets.push(offset)
                  return {
                    limit: (limit: number) => ({
                      get: async () => ({
                        data: wheels.slice(offset, offset + limit),
                      }),
                    }),
                  }
                },
              }),
            }),
          }),
        }),
      },
      getStorageSync: () => undefined,
      setStorageSync: () => undefined,
      removeStorageSync: () => undefined,
    } as unknown as WechatMiniprogram.Wx

    const repository = await import('../miniprogram/services/repository')
    await repository.loginForRecordAccess()

    expect(await repository.listWheels()).toHaveLength(45)
    expect(requestedOffsets).toEqual([0, 20, 40])
  })

  it('clears local state and cloud session after account deletion', async () => {
    const storage = new Map<string, unknown>([
      ['whatsdrink:profile', profile],
      ['whatsdrink:records', [localRecord]],
      ['whatsdrink:wheels', [localWheel]],
      ['whatsdrink:record-draft', localRecord],
    ])
    let loginCalls = 0

    ;(globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      login: ({ success }: WechatMiniprogram.LoginOption) =>
        success?.({ code: 'code', errMsg: 'login:ok' }),
      cloud: {
        callFunction: async ({ name }: { name: string }) => {
          if (name === 'login') {
            loginCalls += 1
            return { result: { ok: true, data: profile } }
          }
          return { result: { ok: true, data: null } }
        },
        database: () => ({
          collection: () => ({
            where: () => ({
              orderBy: () => ({
                skip: () => ({
                  limit: () => ({
                    get: async () => ({ data: [] }),
                  }),
                }),
              }),
            }),
          }),
        }),
      },
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      getFileSystemManager: () => ({
        unlink: ({ success }: { success?: () => void }) => success?.(),
      }),
    } as unknown as WechatMiniprogram.Wx

    const repository = await import('../miniprogram/services/repository')
    await repository.loginForRecordAccess()
    await repository.deleteAccount()
    const profileAfterDeletion = await repository.ensureProfile()

    expect(loginCalls).toBe(1)
    expect(profileAfterDeletion.id).toBe('local-user')
    expect([...storage.keys()]).toEqual(['whatsdrink:profile'])
    expect(repository.hasRecordAccess()).toBe(false)
  })

  it('does not claim account deletion when the configured cloud is unavailable', async () => {
    const storage = new Map<string, unknown>([['whatsdrink:records', [localRecord]]])

    ;(globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      login: ({ success }: WechatMiniprogram.LoginOption) =>
        success?.({ code: 'code', errMsg: 'login:ok' }),
      cloud: {
        callFunction: async () => {
          throw new Error('cloud unavailable')
        },
      },
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      getFileSystemManager: () => ({
        unlink: ({ success }: { success?: () => void }) => success?.(),
      }),
    } as unknown as WechatMiniprogram.Wx

    const repository = await import('../miniprogram/services/repository')

    await expect(repository.deleteAccount()).rejects.toThrow('cloud unavailable')
    expect(storage.get('whatsdrink:records')).toEqual([localRecord])
  })
})
