import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { DrinkRecord } from '../miniprogram/domain/types'

describe('guest record access', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('does not start WeChat login during app launch', () => {
    const appSource = readFileSync('miniprogram/app.ts', 'utf8')

    expect(appSource).not.toContain('wx.login')
    expect(appSource).not.toContain('ensureProfile')
  })

  it('starts record access silently without requiring avatar or nickname', () => {
    const formSource = readFileSync('miniprogram/pages/record-form/index.ts', 'utf8')
    const formTemplate = readFileSync('miniprogram/pages/record-form/index.wxml', 'utf8')

    expect(formSource).toContain('await loginForRecordAccess()')
    expect(formSource).not.toContain('profileIsReady')
    expect(formSource).not.toContain('loginSheetVisible')
    expect(formTemplate).not.toContain('<wechat-login-sheet')
  })

  it('reads local records without querying cloud before login', async () => {
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
      clientRequestId: 'request-1',
      createdAt: 123,
      updatedAt: 123,
    }
    const storage = new Map<string, unknown>([['whatsdrink:records', [localRecord]]])
    let cloudQueries = 0

    ;(globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      cloud: {
        database: () => {
          cloudQueries += 1
          throw new Error('guest must not query cloud')
        },
      },
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    } as unknown as WechatMiniprogram.Wx

    const { listRecords } = await import('../miniprogram/services/repository')
    const records = await listRecords()

    expect(records).toEqual([localRecord])
    expect(cloudQueries).toBe(0)
  })

  it('starts the cloud record session only when record access requests login', async () => {
    let loginCalls = 0
    let loginFunctionCalls = 0
    let cloudQueries = 0

    ;(globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      login: ({ success }: WechatMiniprogram.LoginOption) => {
        loginCalls += 1
        success?.({ code: 'login-code', errMsg: 'login:ok' })
      },
      cloud: {
        callFunction: async ({ name }: { name: string }) => {
          if (name === 'login') loginFunctionCalls += 1
          return {
            result: {
              ok: true,
              data: {
                id: 'cloud-user',
                nickname: '饮品记录者',
                avatarUrl: '',
                createdAt: 123,
                updatedAt: 123,
              },
            },
          }
        },
        database: () => ({
          collection: () => ({
            where: () => ({
              orderBy: () => ({
                skip: () => ({
                  limit: () => ({
                    get: async () => {
                      cloudQueries += 1
                      return { data: [] }
                    },
                  }),
                }),
              }),
            }),
          }),
        }),
      },
      getStorageSync: () => undefined,
      setStorageSync: () => undefined,
    } as unknown as WechatMiniprogram.Wx

    const repository = await import('../miniprogram/services/repository')

    expect(loginCalls).toBe(0)
    await repository.loginForRecordAccess()
    await repository.listRecords()

    expect(loginCalls).toBe(0)
    expect(loginFunctionCalls).toBe(1)
    expect(cloudQueries).toBe(1)
  })

  it('keeps record access available locally when cloud login has no permission', async () => {
    const storage = new Map<string, unknown>()
    let cloudFunctionCalls = 0

    ;(globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      login: ({ success }: WechatMiniprogram.LoginOption) => {
        success?.({ code: 'login-code', errMsg: 'login:ok' })
      },
      cloud: {
        callFunction: async () => {
          cloudFunctionCalls += 1
          throw new Error('cloud permission denied')
        },
      },
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    } as unknown as WechatMiniprogram.Wx

    const repository = await import('../miniprogram/services/repository')
    const profile = await repository.loginForRecordAccess()
    await repository.saveRecord({
      category: 'coffee',
      brandName: '楼下咖啡',
      drinkName: '拿铁',
      size: '中杯',
      temperature: '热',
      sweetness: '无糖',
      calorieSource: 'user',
      note: '',
      consumedAt: 123,
    })

    expect(profile.id).toBe('local-user')
    expect(cloudFunctionCalls).toBe(1)
    expect(storage.get('whatsdrink:records')).toHaveLength(1)
  })
})
