import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const repository = vi.hoisted(() => ({
  ensureProfile: vi.fn(),
  listFootprints: vi.fn(),
  saveGrowthPreferences: vi.fn(),
  startGrowthTrial: vi.fn(),
}))
const productEvents = vi.hoisted(() => ({ trackProductEvent: vi.fn() }))
const performance = vi.hoisted(() => ({
  installUpdatePerformanceLogger: vi.fn(),
  recordInteraction: vi.fn(),
  startPerformanceSpan: vi.fn(() => vi.fn()),
}))

vi.mock('../miniprogram/services/repository', () => repository)
vi.mock('../miniprogram/services/product-events', () => productEvents)
vi.mock('../miniprogram/utils/performance', () => performance)

let definition: Record<string, any>
let page: Record<string, any>

beforeAll(async () => {
  ;(globalThis as any).Page = (value: Record<string, any>) => { definition = value }
  ;(globalThis as any).getApp = () => ({ globalData: {} })
  ;(globalThis as any).wx = {
    navigateTo: vi.fn(),
    showToast: vi.fn(),
    showModal: vi.fn(),
  }
  await import('../miniprogram/pages/growth/index')
})

beforeEach(() => {
  page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch) },
  }
  repository.startGrowthTrial.mockReset()
  repository.ensureProfile.mockReset()
  repository.listFootprints.mockReset()
  vi.mocked(wx.navigateTo).mockReset()
  vi.mocked(wx.showToast).mockReset()
  vi.mocked(wx.showModal).mockReset()
})

describe('growth membership entry behavior', () => {
  it('opens the membership page for an active member instead of claiming every member is in trial', async () => {
    page.data.snapshot = { isPlus: true }
    await page.onStartTrial()

    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/membership/index' })
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(repository.startGrowthTrial).not.toHaveBeenCalled()
  })

  it('sends an expired trial user to the Plus plan instead of offering another trial', async () => {
    page.data.profile = { growth: { trialStartedAt: Date.now() - 10 * 86_400_000 } }
    vi.mocked(wx.showModal).mockImplementation(({ success }: any) => success({ confirm: true }))

    await page.offerTrial('Plus 可以回看历史月份。')

    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Plus 体验已结束',
      confirmText: '查看 Plus',
    }))
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/membership/index' })
    expect(repository.startGrowthTrial).not.toHaveBeenCalled()
  })

  it('stops applying a paid Lumi theme after membership expires', async () => {
    const now = Date.now()
    repository.ensureProfile.mockResolvedValue({
      id: 'expired-member', nickname: '', avatarUrl: '',
      growth: { plusUntil: now - 1, iconColorId: 'highlight' },
      createdAt: 1, updatedAt: 1,
    })
    repository.listFootprints.mockResolvedValue([])
    page.isVisible = true

    await page.loadGrowth()

    expect(page.data.snapshot.isPlus).toBe(false)
    expect(page.data.iconColorId).toBe(page.data.snapshot.activeColorId)
    expect(page.data.iconColorId).not.toBe('highlight')
  })
})
