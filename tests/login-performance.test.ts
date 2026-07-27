import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserProfile } from '../miniprogram/domain/types'

const cloudProfile: UserProfile = {
  id: 'cloud-user',
  nickname: 'Ethan',
  avatarUrl: 'cloud://avatar.jpg',
  createdAt: 1,
  updatedAt: 2,
}

const installWx = (
  storage: Map<string, unknown>,
  callFunction: (name: string) => Promise<{ result: { ok: boolean; data: unknown } }>,
  onWxLogin: () => void = () => undefined,
) => {
  ;(globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
    login: ({ success }: WechatMiniprogram.LoginOption) => {
      onWxLogin()
      success?.({ code: 'unused-code', errMsg: 'login:ok' })
    },
    cloud: {
      callFunction: ({ name }: { name: string }) => callFunction(name),
    },
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
  } as unknown as WechatMiniprogram.Wx
}

describe('login performance', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('uses the CloudBase user context without an extra wx.login round trip', async () => {
    let wxLoginCalls = 0
    installWx(
      new Map(),
      async () => ({ result: { ok: true, data: cloudProfile } }),
      () => {
        wxLoginCalls += 1
      },
    )

    const repository = await import('../miniprogram/services/repository')
    await repository.loginForRecordAccess()

    expect(wxLoginCalls).toBe(0)
  })

  it('returns the cached cloud profile after login without calling login twice', async () => {
    let cloudLoginCalls = 0
    installWx(new Map(), async (name) => {
      if (name === 'login') cloudLoginCalls += 1
      return { result: { ok: true, data: cloudProfile } }
    })

    const repository = await import('../miniprogram/services/repository')
    await repository.loginForRecordAccess()
    expect(await repository.ensureProfile()).toEqual(cloudProfile)

    expect(cloudLoginCalls).toBe(1)
  })

  it('does not migrate a profile that already belongs to the cloud user', async () => {
    const storage = new Map<string, unknown>([['whatsdrink:profile', cloudProfile]])
    const cloudCalls: string[] = []
    installWx(storage, async (name) => {
      cloudCalls.push(name)
      return { result: { ok: true, data: cloudProfile } }
    })

    const repository = await import('../miniprogram/services/repository')
    await repository.loginForRecordAccess()

    expect(cloudCalls).toEqual(['login'])
  })

  it('starts independent profile and wheel lookups concurrently in the login function', () => {
    const source = readFileSync('cloudfunctions/login/index.js', 'utf8')

    expect(source).toMatch(
      /Promise\.all\(\s*\[\s*collection\.where\(\{ _openid: OPENID \}\)\.limit\(1\)\.get\(\),\s*wheelCollection\.where\(\{ _openid: OPENID \}\)\.limit\(1\)\.get\(\),?\s*\]\s*\)/s,
    )
  })

  it('runs first-time profile and wheel creation as one concurrent setup batch', () => {
    const source = readFileSync('cloudfunctions/login/index.js', 'utf8')

    expect(source).toContain('const setupTasks = []')
    expect(source).toContain('setupTasks.push(wheelCollection.add(')
    expect(source).toContain('setupTasks.push(collection.add(')
    expect(source).toContain('await Promise.all(setupTasks)')
  })
})
