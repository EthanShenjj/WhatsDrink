import { beforeEach, describe, expect, it, vi } from 'vitest'

let storage: Record<string, any>

beforeEach(() => {
  vi.resetModules()
  storage = {}
  ;(globalThis as any).getApp = () => ({ globalData: {} })
  ;(globalThis as any).wx = {
    getStorageSync: (key: string) => storage[key],
    setStorageSync: (key: string, value: unknown) => { storage[key] = value },
    cloud: undefined,
  }
})

describe('Lumi display preference', () => {
  it('saves an earned fixed color and removes it when automatic mode is selected', async () => {
    const { saveGrowthPreferences } = await import('../miniprogram/services/repository')

    const fixed = await saveGrowthPreferences({ lockedColorId: 'explore' })
    expect(fixed.growth?.lockedColorId).toBe('explore')

    const automatic = await saveGrowthPreferences({ lockedColorId: null })
    expect(automatic.growth?.lockedColorId).toBeUndefined()
    expect(storage['shiguangji:profile'].growth.lockedColorId).toBeUndefined()
  })

  it('sends an explicit null to the cloud when returning to automatic mode', async () => {
    const calls: Array<{ name: string; data: any }> = []
    const remote = {
      id: 'cloud-user', nickname: '', avatarUrl: '',
      growth: { lockedColorId: 'explore' as const }, createdAt: 1, updatedAt: 1,
    }
    ;(globalThis as any).wx.cloud = {
      init: vi.fn(),
      callFunction: vi.fn(async ({ name, data }: { name: string; data: any }) => {
        calls.push({ name, data })
        if (name === 'login') return { result: { ok: true, data: remote } }
        if (data.patch.lockedColorId === null) delete (remote.growth as { lockedColorId?: string }).lockedColorId
        return { result: { ok: true, data: remote } }
      }),
    }
    const { loginForAccess, saveGrowthPreferences } = await import('../miniprogram/services/repository')
    await loginForAccess()

    const automatic = await saveGrowthPreferences({ lockedColorId: null })

    expect(calls[calls.length - 1]).toMatchObject({
      name: 'accountMutation',
      data: { action: 'saveGrowthPreferences', patch: { lockedColorId: null } },
    })
    expect(automatic.growth?.lockedColorId).toBeUndefined()
  })
})
