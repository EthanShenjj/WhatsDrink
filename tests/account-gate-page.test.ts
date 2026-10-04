import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const repository = vi.hoisted(() => ({
  isSignedOut: vi.fn(),
  resumeAccount: vi.fn(),
  syncPendingFootprints: vi.fn(),
}))
const events = vi.hoisted(() => ({ flushProductEvents: vi.fn() }))
vi.mock('../miniprogram/services/repository', () => repository)
vi.mock('../miniprogram/services/product-events', () => events)

let definition: Record<string, any>
let page: Record<string, any>
const app = { globalData: {} as Record<string, any> }

beforeAll(async () => {
  ;(globalThis as any).Page = (value: Record<string, any>) => { definition = value }
  ;(globalThis as any).getApp = () => app
  ;(globalThis as any).wx = { reLaunch: vi.fn() }
  await import('../miniprogram/pages/account-gate/index')
})

beforeEach(() => {
  page = {
    ...definition,
    data: { ...definition.data },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch) },
  }
  app.globalData = {}
  repository.isSignedOut.mockReset().mockReturnValue(true)
  repository.resumeAccount.mockReset().mockResolvedValue({ id: 'cloud-user', nickname: '', avatarUrl: '' })
  repository.syncPendingFootprints.mockReset().mockResolvedValue(undefined)
  events.flushProductEvents.mockReset().mockResolvedValue(undefined)
  vi.mocked(wx.reLaunch).mockReset()
})

describe('signed-out return page', () => {
  it('stays on the gate after a failed cloud login and allows retry', async () => {
    repository.resumeAccount.mockRejectedValueOnce(new Error('无法连接云端，请联网后重试'))
    await page.onEnter()
    expect(page.data.error).toBe('无法连接云端，请联网后重试')
    expect(page.data.entering).toBe(false)
    expect(wx.reLaunch).not.toHaveBeenCalled()
    await page.onEnter()
    expect(wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/map/index' })
  })

  it('starts pending sync only after the account has been restored', async () => {
    let finish!: (profile: unknown) => void
    repository.resumeAccount.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const operation = page.onEnter()
    await vi.waitFor(() => expect(page.data.entering).toBe(true))
    await page.onEnter()
    expect(repository.resumeAccount).toHaveBeenCalledTimes(1)
    expect(repository.syncPendingFootprints).not.toHaveBeenCalled()
    finish({ id: 'cloud-user', nickname: '', avatarUrl: '' })
    await operation
    expect(app.globalData.cloudEnabled).toBe(true)
    expect(repository.syncPendingFootprints).toHaveBeenCalledOnce()
    expect(events.flushProductEvents).toHaveBeenCalledOnce()
    expect(wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/map/index' })
  })
})
