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
  didFootprintCloudLoadFail: vi.fn(() => false),
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
  repositoryMocks.didFootprintCloudLoadFail.mockReturnValue(false)
  repositoryMocks.hasCloudAccess.mockReturnValue(false)
  vi.mocked(wx.getSetting).mockReset()
  vi.mocked(wx.getLocation).mockReset()
  vi.mocked(wx.showModal).mockReset()
  vi.mocked(wx.showLoading).mockReset()
  vi.mocked(wx.hideLoading).mockReset()
  vi.mocked(wx.showToast).mockReset()
  vi.mocked(wx.navigateTo).mockReset()
})

describe('map startup location flow', () => {
  it('shows a retry state when the initial footprint request fails', async () => {
    repositoryMocks.listFootprints.mockRejectedValueOnce(new Error('offline'))
    const page = createPage()
    page.isVisible = true
    await page.loadFootprints(true)
    expect(page.data.dataLoadFailed).toBe(true)
    expect(page.data.loading).toBe(false)
    repositoryMocks.listFootprints.mockResolvedValueOnce([])
    repositoryMocks.hasCloudAccess.mockReturnValue(true)
    page.retryFootprints()
    await vi.waitFor(() => expect(page.data.dataLoadFailed).toBe(false))
  })

  it('does not mistake a failed cloud request with an empty local cache for an empty account', async () => {
    repositoryMocks.didFootprintCloudLoadFail.mockReturnValue(true)
    const page = createPage()
    page.isVisible = true
    await page.loadFootprints(true)
    expect(page.data.dataLoadFailed).toBe(true)
    expect(page.data.modeEmpty).toBe(true)
  })
  it('opens a city-only user on the lighting map without requesting new location permission', () => {
    vi.mocked(wx.getSetting).mockImplementation(({ success }: any) => success({ authSetting: {} }))
    const page = createPage()
    page.applyFootprints([{ id: 'city-one', status: 'visited', recordLevel: 'city', poiName: '成都', country: '中国', province: '四川', city: '成都', photos: [], tags: [], createdAt: 1, updatedAt: 1 }])
    expect(page.data.mode).toBe('lighting')
    expect(page.data.lighting).toMatchObject({ cities: 1, places: 0, visitedCount: 0 })
    page.onShow()
    expect(wx.getLocation).not.toHaveBeenCalled()
  })
  it('refreshes the user position when explicitly switching back to the map tab', async () => {
    vi.mocked(wx.getSetting).mockImplementation(({ success }: any) => success({ authSetting: { 'scope.userLocation': true } }))
    vi.mocked(wx.getLocation)
      .mockImplementationOnce(({ success }: any) => success({ latitude: 31.2304, longitude: 121.4737 }))
      .mockImplementationOnce(({ success }: any) => success({ latitude: 30.2741, longitude: 120.1551 }))
    const page = createPage()
    page.onShow()
    await vi.waitFor(() => expect(page.data.locationStatus).toBe('located'))
    page.onHide()
    storage['sgj:map-tab-entry'] = true
    page.onShow()
    await vi.waitFor(() => expect(page.data.center).toEqual({ latitude: 30.2741, longitude: 120.1551 }))
    expect(storage['sgj:map-tab-entry']).toBeUndefined()
    expect(wx.getLocation).toHaveBeenCalledTimes(2)
    expect(wx.showLoading).not.toHaveBeenCalled()
    expect(wx.navigateTo).not.toHaveBeenCalled()
    expect(page.data.checkinVisible).toBe(false)
  })

  it('ignores a late automatic location after focusing a record and still allows manual location', async () => {
    let completeLocation!: (value: any) => void
    vi.mocked(wx.getSetting).mockImplementation(({ success }: any) => success({ authSetting: { 'scope.userLocation': true } }))
    vi.mocked(wx.getLocation)
      .mockImplementationOnce(({ success }: any) => { completeLocation = success })
      .mockImplementationOnce(({ success }: any) => success({ latitude: 31.2304, longitude: 121.4737 }))
    const page = createPage()
    page.onShow()
    const target = { id: 'target', status: 'visited', lat: 30.2741, lng: 120.1551, photos: [], tags: [] }
    storage['sgj:map-target'] = target
    page.onShow()
    completeLocation({ latitude: 31.2304, longitude: 121.4737 })
    await Promise.resolve()
    await Promise.resolve()
    expect(page.data.center).toEqual({ latitude: target.lat, longitude: target.lng })
    page.onLocate()
    await vi.waitFor(() => expect(page.data.center).toEqual({ latitude: 31.2304, longitude: 121.4737 }))
    expect(page.data.checkinVisible).toBe(false)
  })

  it('preserves a detail target on ordinary return until the user explicitly requests their location', () => {
    const page = createPage()
    storage['sgj:map-target'] = { id: 'target', status: 'visited', lat: 30.2741, lng: 120.1551, photos: [], tags: [] }
    page.onShow()
    page.onHide()
    page.onShow()
    expect(wx.getSetting).not.toHaveBeenCalled()
    expect(page.data.center).toEqual({ latitude: 30.2741, longitude: 120.1551 })
  })

  it('automatically retries location after a failed first entry when returning to the map tab', async () => {
    vi.mocked(wx.getSetting).mockImplementation(({ success }: any) => success({ authSetting: { 'scope.userLocation': true } }))
    vi.mocked(wx.getLocation)
      .mockImplementationOnce(({ fail }: any) => fail({ errMsg: 'getLocation:fail network' }))
      .mockImplementationOnce(({ success }: any) => success({ latitude: 30.2741, longitude: 120.1551 }))
    const page = createPage()
    page.onShow()
    await vi.waitFor(() => expect(page.initialLocationResolved).toBe(true))
    page.onHide()
    page.onShow()
    await vi.waitFor(() => expect(page.data.center).toEqual({ latitude: 30.2741, longitude: 120.1551 }))
    expect(page.data.hasLocationAuth).toBe(true)
    expect(wx.getLocation).toHaveBeenCalledTimes(2)
  })

  it('automatically locates after permission is enabled without restarting the mini-program', async () => {
    vi.mocked(wx.getSetting)
      .mockImplementationOnce(({ success }: any) => success({ authSetting: { 'scope.userLocation': false } }))
      .mockImplementationOnce(({ success }: any) => success({ authSetting: { 'scope.userLocation': true } }))
    vi.mocked(wx.getLocation).mockImplementation(({ success }: any) => success({ latitude: 30.2741, longitude: 120.1551 }))
    const page = createPage()
    page.onShow()
    expect(wx.getLocation).not.toHaveBeenCalled()
    page.onHide()
    page.onShow()
    await vi.waitFor(() => expect(page.data.hasLocationAuth).toBe(true))
    expect(wx.showModal).not.toHaveBeenCalled()
  })

  it('does not mark tiles ready just because a timeout or regionchange fires', () => {
    vi.useFakeTimers()
    const page = createPage()
    page.mapReady = true
    page.scheduleMapReadyFallback()
    vi.advanceTimersByTime(5000)
    expect(page.data.mapTilesReady).toBe(false)
    expect(page.data.mapLoadDelayed).toBe(true)
    page.onRegionChange({ detail: { type: 'end', scale: page.mapScale } })
    expect(page.data.mapTilesReady).toBe(false)
    page.onMapUpdated()
    expect(page.data.mapTilesReady).toBe(true)
    expect(page.data.mapLoadDelayed).toBe(false)
    vi.useRealTimers()
  })

  it('labels filtered empty results and clears filters without opening a new record', () => {
    const page = createPage()
    page.applyFilter({ mood: 'no-match' })
    expect(page.data.modeEmptyTitle).toBe('没有符合筛选的记录')
    page.onEmptyAction()
    expect(page.data.activeFilterCount).toBe(0)
    expect(wx.navigateTo).not.toHaveBeenCalled()
  })

  it('focuses an explicit detail-page target instead of fitting unrelated footprints or locating again', () => {
    const page = createPage()
    const target = { id: 'target', poiName: '杭州地点', status: 'wishlist', lat: 30.2741, lng: 120.1551, photos: [], tags: [] }
    storage['sgj:map-target'] = target
    page.onShow()
    expect(page.data.center).toEqual({ latitude: target.lat, longitude: target.lng })
    expect(page.data.mode).toBe('wishlist')
    expect(page.data.selectedFootprint.id).toBe('target')
    expect(storage['sgj:map-target']).toBeUndefined()
    expect(wx.getLocation).not.toHaveBeenCalled()
  })

  it('opens lighting at a nationwide view even when footprints are close together', () => {
    const page = createPage()
    const footprints = [{
      id: 'shanghai-memory',
      userId: 'test-user',
      status: 'visited',
      poiName: '上海的一处地点',
      lat: 31.2304,
      lng: 121.4737,
      photos: [],
      tags: [],
      source: 'manual',
      clientRequestId: 'req-shanghai',
      createdAt: 1,
      updatedAt: 1,
    }]
    page.applyFootprints(footprints)
    page.setData({ center: { latitude: 31.2304, longitude: 121.4737 }, scale: 16 })

    page.applyMode('lighting', { fit: true })
    expect(page.data.center).toEqual({ latitude: 35, longitude: 105 })
    expect(page.data.scale).toBe(3)

    page.setData({ center: { latitude: 31.2304, longitude: 121.4737 }, scale: 16 })
    page.applyFootprints([...footprints], { fit: true })
    expect(page.data.center).toEqual({ latitude: 35, longitude: 105 })
    expect(page.data.scale).toBe(3)
  })

  it('does not let a late automatic location zoom lighting back to the user', async () => {
    vi.mocked(wx.getLocation).mockImplementation(({ success }: any) => {
      success?.({ latitude: 31.2304, longitude: 121.4737 })
    })
    const page = createPage()
    page.applyMode('lighting', { fit: true })

    page.requestInitialLocation()
    await vi.waitFor(() => expect(page.initialLocationResolved).toBe(true))

    expect(page.data.center).toEqual({ latitude: 35, longitude: 105 })
    expect(page.data.scale).toBe(3)
    expect(page.data.hasLocationAuth).toBe(true)
  })

  it('fills visited provinces and opens their memory card from a map tap', () => {
    const page = createPage()
    page.applyFootprints([{
      id: 'chengdu-memory',
      userId: 'test-user',
      status: 'visited',
      poiName: '人民公园',
      city: '成都',
      lat: 30.67,
      lng: 104.05,
      visitDate: '2026-09-02',
      photos: [],
      tags: [],
      source: 'manual',
      clientRequestId: 'req-chengdu',
      createdAt: 1,
      updatedAt: 1,
    }])

    page.applyMode('lighting')
    expect(page.data.provincePolygons.length).toBeGreaterThan(0)
    expect(page.data.growthCircles).toHaveLength(0)

    page.onMapTap({ detail: { latitude: 30.5728, longitude: 104.0668 } })
    expect(page.data.selectedProvince).toBe('四川省')
    expect(page.data.selectedProvinceOverview).toMatchObject({ places: 1, visits: 1 })

    page.onProvinceChipTap({ currentTarget: { dataset: { name: '四川省' } } })
    expect(page.data.scale).toBeGreaterThan(3)
    page.onProvinceCardClose()
    expect(page.data.selectedProvince).toBe('')
    expect(page.data.center).toEqual({ latitude: 35, longitude: 105 })
    expect(page.data.scale).toBe(3)

    page.applyMode('visited')
    expect(page.data.provincePolygons).toHaveLength(0)
    expect(page.data.selectedProvince).toBe('')
  })

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
