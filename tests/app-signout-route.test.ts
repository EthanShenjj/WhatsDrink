import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const repository = vi.hoisted(() => ({
  hasCloudAccess: vi.fn(),
  initializeCloud: vi.fn(),
  isSignedOut: vi.fn(),
  loginForAccess: vi.fn(),
  syncPendingFootprints: vi.fn(),
}))
const events = vi.hoisted(() => ({ flushProductEvents: vi.fn(), trackFirstOpen: vi.fn() }))
vi.mock('../miniprogram/services/repository', () => repository)
vi.mock('../miniprogram/services/product-events', () => events)

let definition: Record<string, any>
let route = 'pages/map/index'

beforeAll(async () => {
  vi.useFakeTimers()
  ;(globalThis as any).App = (value: Record<string, any>) => { definition = value }
  ;(globalThis as any).getCurrentPages = () => [{ route }]
  ;(globalThis as any).wx = { onNetworkStatusChange: vi.fn(), reLaunch: vi.fn() }
  await import('../miniprogram/app')
})

afterAll(() => vi.useRealTimers())

describe('app startup after sign-out', () => {
  it('opens the return page without starting a background cloud login', async () => {
    repository.isSignedOut.mockReturnValue(true)
    repository.loginForAccess.mockReset()
    repository.initializeCloud.mockReset()
    vi.mocked(wx.reLaunch).mockReset()
    const app = { globalData: { cloudEnabled: false } }
    definition.onLaunch.call(app)
    definition.onShow.call(app)
    await vi.runAllTimersAsync()
    expect(repository.loginForAccess).not.toHaveBeenCalled()
    expect(repository.initializeCloud).not.toHaveBeenCalled()
    expect(wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/account-gate/index' })

    route = 'pages/account-gate/index'
    vi.mocked(wx.reLaunch).mockClear()
    definition.onShow.call(app)
    await vi.runAllTimersAsync()
    expect(wx.reLaunch).not.toHaveBeenCalled()
  })
})
