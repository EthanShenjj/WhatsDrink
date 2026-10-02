import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const repositoryMocks = vi.hoisted(() => ({
  listFootprints: vi.fn(async (): Promise<any[]> => []),
  loginForAccess: vi.fn(async () => ({
    id: 'test-user',
    nickname: '',
    avatarUrl: '',
    createdAt: 1,
    updatedAt: 1,
  })),
  getLocalProfile: vi.fn(() => ({
    id: 'test-user',
    nickname: '',
    avatarUrl: '',
    createdAt: 1,
    updatedAt: 1,
  })),
  hasCloudAccess: vi.fn(() => false),
  getMapSettings: vi.fn(() => ({
    markerStyle: 'emoji',
    theme: 'clean',
    clusterEnabled: true,
  })),
  saveMapSettings: vi.fn(),
  getFootprintSnapshot: vi.fn(() => null),
}))

vi.mock('../miniprogram/services/repository', () => repositoryMocks)

type PageDefinition = Record<string, any> & { data: Record<string, any> }

let definition: PageDefinition
let storage: Record<string, unknown>

const createPage = (): PageDefinition => {
  const page: PageDefinition = {
    ...definition,
    data: { ...definition.data },
    setData(patch: Record<string, unknown>, callback?: () => void) {
      Object.assign(this.data, patch)
      callback?.()
    },
    getTabBar: () => null,
  }
  return page
}

beforeAll(async () => {
  ;(globalThis as any).getApp = () => ({ globalData: {} })
  ;(globalThis as any).Page = (options: PageDefinition) => {
    definition = options
  }
  ;(globalThis as any).wx = {
    getStorageSync: vi.fn((key: string) => storage[key]),
    setStorageSync: vi.fn((key: string, value: unknown) => { storage[key] = value }),
    removeStorageSync: vi.fn((key: string) => { delete storage[key] }),
    getSetting: vi.fn(),
    getLocation: vi.fn(),
    showModal: vi.fn(),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    showToast: vi.fn(),
    vibrateShort: vi.fn(),
    navigateTo: vi.fn(),
    createMapContext: vi.fn(),
    nextTick: vi.fn((callback: () => void) => callback()),
    getWindowInfo: vi.fn(() => ({ statusBarHeight: 20 })),
  }
  await import('../miniprogram/pages/map/index')
})

beforeEach(() => {
  storage = {}
  repositoryMocks.listFootprints.mockReset()
  repositoryMocks.listFootprints.mockResolvedValue([])
  repositoryMocks.getFootprintSnapshot.mockReturnValue(null)
  vi.mocked(wx.getSetting).mockReset()
  vi.mocked(wx.getLocation).mockReset()
  vi.mocked(wx.showModal).mockReset()
  vi.mocked(wx.showLoading).mockReset()
  vi.mocked(wx.hideLoading).mockReset()
  vi.mocked(wx.showToast).mockReset()
  vi.mocked(wx.navigateTo).mockReset()
})

describe('map startup location flow', () => {
  it('lets a pending quick check-in own the cold-start location request', async () => {
    storage['sgj:pending-map-action'] = 'checkin'
    vi.mocked(wx.getSetting).mockImplementation(({ success }: any) => {
      success?.({ authSetting: { 'scope.userLocation': false } })
    })
    vi.mocked(wx.showModal).mockImplementation(() => undefined as any)
    const page = createPage()

    const loading = page.initData()
    page.onShow()
    await loading

    expect(wx.getSetting).toHaveBeenCalledTimes(1)
    expect(wx.showModal).toHaveBeenCalledTimes(1)
    expect(page.initialLocationStarted).toBe(true)
    expect(storage['sgj:pending-map-action']).toBeUndefined()
  })

  it('runs one quiet auto-location check during a normal cold start', async () => {
    vi.mocked(wx.getSetting).mockImplementation(({ success }: any) => {
      success?.({ authSetting: { 'scope.userLocation': false } })
    })
    const page = createPage()

    const loading = page.initData()
    page.onShow()
    await loading

    expect(wx.getSetting).toHaveBeenCalledTimes(1)
    expect(wx.showModal).not.toHaveBeenCalled()
    expect(page.initialLocationStarted).toBe(true)
  })

  it('applies the latest repository snapshot immediately when returning from save', () => {
    const latest = [{
      id: 'new-footprint',
      userId: 'test-user',
      status: 'visited',
      poiName: '新足迹',
      lat: 31.2304,
      lng: 121.4737,
      photos: [],
      tags: [],
      source: 'manual',
      clientRequestId: 'req-new',
      createdAt: 1,
      updatedAt: 1,
    }]
    repositoryMocks.getFootprintSnapshot.mockReturnValue(latest as any)
    vi.mocked(wx.getSetting).mockImplementation(({ success }: any) => {
      success?.({ authSetting: { 'scope.userLocation': false } })
    })
    const page = createPage()
    page.applyFootprints = vi.fn()

    page.onShow()

    expect(page.applyFootprints).toHaveBeenCalledWith(latest, { fit: true })
    expect(page.pendingFootprints).toBeNull()
  })

  it('keeps the current-location viewport when check-in data refreshes after save', () => {
    const latest = [{
      id: 'checkin-footprint',
      userId: 'test-user',
      status: 'visited',
      poiName: '打卡地点',
      lat: 31.2304,
      lng: 121.4737,
      photos: [],
      tags: [],
      source: 'manual',
      clientRequestId: 'req-checkin',
      createdAt: 1,
      updatedAt: 1,
    }]
    repositoryMocks.getFootprintSnapshot.mockReturnValue(latest as any)
    vi.mocked(wx.getSetting).mockImplementation(({ success }: any) => {
      success?.({ authSetting: { 'scope.userLocation': true } })
    })
    vi.mocked(wx.getLocation).mockImplementation(() => undefined as any)
    const page = createPage()
    page.hasCenteredOnUser = true
    page.applyFootprints = vi.fn()

    page.onShow()

    expect(page.applyFootprints).toHaveBeenCalledWith(latest, { fit: false })
  })

  it('centers quick check-in with one declarative map update', async () => {
    const moveToLocation = vi.fn()
    vi.mocked(wx.createMapContext).mockReturnValue({ moveToLocation } as any)
    vi.mocked(wx.getLocation).mockImplementation(({ success, complete }: any) => {
      success?.({ latitude: 31.2304, longitude: 121.4737 })
      complete?.()
    })
    const page = createPage()
    page.onReady()

    await page.requestCheckinLocation()

    expect(page.hasCenteredOnUser).toBe(true)
    expect(page.data.center).toEqual({ latitude: 31.2304, longitude: 121.4737 })
    expect(page.data.hasLocationAuth).toBe(true)
    expect(moveToLocation).not.toHaveBeenCalled()
    page.onUnload()
  })

  it('waits for the initial footprint snapshot before matching a cold-start check-in', async () => {
    let resolveFootprints!: (value: any[]) => void
    repositoryMocks.listFootprints.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFootprints = resolve
    }))
    vi.mocked(wx.getLocation).mockImplementation(({ success }: any) => {
      success?.({ latitude: 31.2304, longitude: 121.4737 })
    })
    const page = createPage()
    page.isVisible = true
    page.initialDataPromise = page.loadFootprints(false, true)

    const checkin = page.requestCheckinLocation()
    await Promise.resolve()
    expect(page.data.checkinVisible).toBe(false)

    resolveFootprints([{
      id: 'nearby',
      userId: 'test-user',
      status: 'visited',
      poiName: '附近足迹',
      lat: 31.2305,
      lng: 121.4738,
      photos: [],
      tags: [],
      source: 'manual',
      clientRequestId: 'req-nearby',
      createdAt: 1,
      updatedAt: 1,
    }])
    await checkin

    expect(page.data.checkinVisible).toBe(true)
    expect(page.data.checkinCandidate?.footprint.id).toBe('nearby')
  })

  it('shares an in-flight location request between startup and quick check-in', async () => {
    let resolveLocation!: (value: { latitude: number; longitude: number }) => void
    vi.mocked(wx.getLocation).mockImplementation(({ success, fail }: any) => {
      new Promise<{ latitude: number; longitude: number }>((resolve) => {
        resolveLocation = resolve
      }).then(success, fail)
    })
    const page = createPage()
    page.requestInitialLocation()
    page.checkinLocationRequested = true
    const checkin = page.requestCheckinLocation()

    expect(wx.getLocation).toHaveBeenCalledTimes(1)
    resolveLocation({ latitude: 31.2304, longitude: 121.4737 })
    await checkin

    expect(page.data.scale).toBe(16)
    expect(page.data.checkinVisible).toBe(true)
  })

  it('hands the matched footprint to the form before navigating', () => {
    const footprint = {
      id: 'nearby',
      userId: 'test-user',
      status: 'visited',
      poiName: '附近足迹',
      lat: 31.2304,
      lng: 121.4737,
      photos: [],
      tags: [],
      source: 'manual',
      clientRequestId: 'req-nearby',
      createdAt: 1,
      updatedAt: 1,
    }
    const page = createPage()
    page.data.checkinCandidate = { footprint, distance: 12, action: 'revisit' }

    page.onCheckinConfirm()

    expect(storage['sgj:checkin-source']).toBe(footprint)
    expect(wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/footprint-form/index?revisit=nearby&checkin=1&distance=12',
    }))
  })
})
