import { beforeEach, describe, expect, it, vi } from 'vitest'

let storage: Record<string, any>
let online: boolean
let calls: Array<{ name: string; data: any }>
let app: { globalData: Record<string, any> }

beforeEach(() => {
  vi.resetModules()
  storage = {}
  online = true
  calls = []
  app = { globalData: {} }
  ;(globalThis as any).getApp = () => app
  ;(globalThis as any).wx = {
    getStorageSync: (key: string) => storage[key],
    setStorageSync: (key: string, value: unknown) => { storage[key] = value },
    removeStorageSync: (key: string) => { delete storage[key] },
    cloud: {
      init: vi.fn(),
      callFunction: vi.fn(async ({ name, data }: { name: string; data: any }) => {
        calls.push({ name, data })
        if (!online) throw new Error('network offline')
        if (name === 'login') return { result: { ok: true, data: { id: 'cloud-user', nickname: '测试', avatarUrl: '', createdAt: 1, updatedAt: 1 } } }
        return { result: { ok: true, data: [] } }
      }),
    },
  }
})

describe('account sign-out and return', () => {
  it('hides local records and prevents automatic cloud login while signed out', async () => {
    const repo = await import('../miniprogram/services/repository')
    await repo.loginForAccess()
    storage['shiguangji:footprints'] = [{ id: 'private-place', photos: [] }]
    repo.signOutAccount()
    const cloudCalls = calls.length

    expect(repo.isSignedOut()).toBe(true)
    expect(repo.hasCloudAccess()).toBe(false)
    expect(repo.getLocalProfile().nickname).toBe('')
    expect(repo.getFootprintSnapshot()).toBeNull()
    expect(await repo.listFootprints()).toEqual([])
    await repo.loginForAccess({ force: true })
    expect(calls).toHaveLength(cloudCalls)
    expect(storage['shiguangji:footprints']).toHaveLength(1)
    expect(app.globalData.profile).toBeUndefined()
  })

  it('keeps the gate and records on failed return, then restores access after a successful cloud login', async () => {
    const repo = await import('../miniprogram/services/repository')
    storage['shiguangji:footprints'] = [{ id: 'private-place', photos: [] }]
    repo.signOutAccount()
    online = false
    await expect(repo.resumeAccount()).rejects.toThrow('无法连接云端')
    expect(repo.isSignedOut()).toBe(true)
    expect(storage['shiguangji:footprints']).toHaveLength(1)
    online = true

    const profile = await repo.resumeAccount()
    expect(profile.id).toBe('cloud-user')
    expect(repo.isSignedOut()).toBe(false)
    expect(repo.hasCloudAccess()).toBe(true)
    expect(storage['shiguangji:footprints']).toHaveLength(1)
  })

  it('ignores an automatic login response that arrives after sign-out', async () => {
    const repo = await import('../miniprogram/services/repository')
    let complete!: (value: any) => void
    vi.mocked(wx.cloud.callFunction).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    const login = repo.loginForAccess()
    repo.signOutAccount()
    complete({ result: { ok: true, data: { id: 'cloud-user', nickname: '旧资料', avatarUrl: '', createdAt: 1, updatedAt: 1 } } })
    await login

    expect(repo.isSignedOut()).toBe(true)
    expect(repo.hasCloudAccess()).toBe(false)
    expect(storage['shiguangji:profile']).toBeUndefined()
  })
})
