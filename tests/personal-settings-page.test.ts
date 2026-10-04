import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const repository = vi.hoisted(() => ({
  clearAllData: vi.fn(),
  deleteAccount: vi.fn(),
  ensureProfile: vi.fn(),
  signOutAccount: vi.fn(),
}))
vi.mock('../miniprogram/services/repository', () => repository)
vi.mock('../miniprogram/services/export', () => ({ buildDataExport: vi.fn() }))

let definition: Record<string, any>
let page: Record<string, any>
const app = { globalData: { profile: { id: 'user-1' }, footprints: [{ id: 'place-1' }], footprintsCachedAt: 1, cloudEnabled: true } as Record<string, any> }

beforeAll(async () => {
  ;(globalThis as any).Page = (value: Record<string, any>) => { definition = value }
  ;(globalThis as any).getApp = () => app
  ;(globalThis as any).wx = {
    showModal: vi.fn(),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    showToast: vi.fn(),
    exitMiniProgram: vi.fn(),
    reLaunch: vi.fn(),
  }
  await import('../miniprogram/pages/personal-settings/index')
})

beforeEach(() => {
  page = {
    ...definition,
    data: { ...definition.data },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch) },
  }
  app.globalData.profile = { id: 'user-1' }
  app.globalData.footprints = [{ id: 'place-1' }]
  app.globalData.cloudEnabled = true
  repository.deleteAccount.mockReset().mockResolvedValue(undefined)
  repository.signOutAccount.mockReset()
  for (const method of ['showModal', 'showLoading', 'hideLoading', 'showToast', 'exitMiniProgram', 'reLaunch'] as const) {
    vi.mocked(wx[method]).mockReset()
  }
})

describe('personal settings account deletion', () => {
  it('does not sign out when the user cancels', async () => {
    vi.mocked(wx.showModal).mockImplementation(({ success }: any) => success({ confirm: false }))
    await page.onSignOut()
    expect(repository.signOutAccount).not.toHaveBeenCalled()
    expect(wx.reLaunch).not.toHaveBeenCalled()
  })

  it('locks the app and opens the return page after sign-out is confirmed', async () => {
    vi.mocked(wx.showModal).mockImplementation(({ success }: any) => success({ confirm: true }))
    await page.onSignOut()
    expect(repository.signOutAccount).toHaveBeenCalledOnce()
    expect(wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/account-gate/index' })
  })

  it('leaves the account untouched when the confirmation is cancelled', async () => {
    vi.mocked(wx.showModal).mockImplementation(({ success }: any) => success({ confirm: false }))
    await page.onDeleteAccount()
    expect(repository.deleteAccount).not.toHaveBeenCalled()
    expect(wx.showLoading).not.toHaveBeenCalled()
    expect(app.globalData.profile).toEqual({ id: 'user-1' })
  })

  it('shows a retryable error and keeps account state if cloud deletion fails', async () => {
    vi.mocked(wx.showModal).mockImplementation(({ success }: any) => success({ confirm: true }))
    repository.deleteAccount.mockRejectedValueOnce(new Error('无法连接云端，请联网后重试注销'))
    await page.onDeleteAccount()
    expect(wx.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '无法连接云端，请联网后重试注销' }))
    expect(app.globalData.footprints).toEqual([{ id: 'place-1' }])
    expect(page.data.deletingAccount).toBe(false)
    expect(wx.exitMiniProgram).not.toHaveBeenCalled()
  })

  it('prevents duplicate requests and exits only after successful deletion is acknowledged', async () => {
    vi.mocked(wx.showModal).mockImplementation(({ title, success }: any) => {
      if (title === '注销账号') success({ confirm: true })
    })
    let finish!: () => void
    repository.deleteAccount.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const operation = page.onDeleteAccount()
    await vi.waitFor(() => expect(page.data.deletingAccount).toBe(true))
    await page.onDeleteAccount()
    expect(repository.deleteAccount).toHaveBeenCalledTimes(1)
    finish()
    await operation
    expect(app.globalData.profile).toBeUndefined()
    expect(app.globalData.footprints).toEqual([])
    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({ title: '账号已注销' }))
    expect(wx.exitMiniProgram).not.toHaveBeenCalled()
    const successDialog = vi.mocked(wx.showModal).mock.calls.find(([options]) => options.title === '账号已注销')?.[0]
    successDialog?.complete?.({ errMsg: 'showModal:ok' })
    expect(wx.exitMiniProgram).toHaveBeenCalledTimes(1)
  })
})
