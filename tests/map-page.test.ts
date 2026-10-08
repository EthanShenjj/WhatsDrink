import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const repositoryMocks = vi.hoisted(() => ({
  listFootprints: vi.fn(async (_options?: any): Promise<any[]> => []),
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
  vi.mocked(wx.createMapContext).mockReset()
})

describe('map startup location flow', () => {
  it('pairs the quick check-in loading indicator and opens the confirmation sheet', async () => {
    const page = createPage()
    page.isVisible = true
    page.getCurrentLocation = vi.fn().mockResolvedValue({ latitude: 31.23, longitude: 121.47 })
    page.ensureFootprintsForCheckin = vi.fn().mockResolvedValue(undefined)
    page.refreshMarkers = vi.fn()
    page.scheduleMapReadyFallback = vi.fn()
    await page.requestCheckinLocation()
    expect(page.data.checkinVisible).toBe(true)
    expect(wx.showLoading).toHaveBeenCalledTimes(1)
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
  })

  it('responds immediately and reuses startup location when quick check-in is tapped', async () => {
    let resolveLocation!: (value: { latitude: number; longitude: number }) => void
    vi.mocked(wx.getSetting).mockImplementation(({ success }: any) => {
      success?.({ authSetting: { 'scope.userLocation': true } })
    })
    vi.mocked(wx.getLocation).mockImplementation(({ success, fail }: any) => {
      new Promise<{ latitude: number; longitude: number }>((resolve) => {
        resolveLocation = resolve
      }).then(success, fail)
    })
    const page = createPage()
    page.isVisible = true
    page.ensureFootprintsForCheckin = vi.fn().mockResolvedValue(undefined)
    page.requestInitialLocation()

    page.onCheckin()

    expect(page.data.isLocating).toBe(true)
    expect(wx.showLoading).toHaveBeenCalledWith({ title: '正在准备打卡', mask: true })
    expect(wx.getLocation).toHaveBeenCalledTimes(1)

    resolveLocation({ latitude: 31.2304, longitude: 121.4737 })
    await vi.waitFor(() => expect(page.data.checkinVisible).toBe(true))
    expect(page.data.isLocating).toBe(false)
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
  })

  it('gives feedback instead of silently ignoring a repeated quick check-in tap', () => {
    const page = createPage()
    page.checkinLocationRequested = true
    page.data.isLocating = true

    page.onCheckin()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '正在获取位置', icon: 'none' })
    expect(wx.getSetting).not.toHaveBeenCalled()
  })
  it('limits dense native markers and lets a maximum-zoom cluster open its records', () => {
    const page = createPage()
    page.mapReady = true
    page.mapScale = 18
    page.zoomTier = 18
    const records = Array.from({ length: 1000 }, (_, index) => ({
      id: `dense-${index}`, userId: 'test-user', status: 'visited', poiName: `地点${index}`,
      lat: 31.23 + index * 0.00001, lng: 121.47 + index * 0.00001,
      photos: [], tags: [], source: 'manual', clientRequestId: `req-dense-${index}`,
      createdAt: 1, updatedAt: 1,
    }))
    page.applyFootprints(records)
    expect(page.data.markers.length).toBeLessThanOrEqual(200)
    const cluster = page.data.markers.find((marker: any) => marker.isCluster)
    expect(cluster).toBeDefined()
    page.onMarkerTap({ detail: { markerId: cluster.id } })
    expect(page.data.clusterTotal).toBeGreaterThan(1)
    expect(page.data.clusterItems.length).toBeLessThanOrEqual(20)
    page.onClusterItemTap({ currentTarget: { dataset: { id: page.data.clusterItems[0].id } } })
    expect(page.data.detailVisible).toBe(true)
  })

  it('keeps a long unplaced list in 20-item batches', () => {
    const page = createPage()
    page.applyFootprints(Array.from({ length: 45 }, (_, index) => ({
      id: `unplaced-${index}`, userId: 'test-user', status: 'visited', poiName: `地点${index}`,
      photos: [], tags: [], source: 'manual', clientRequestId: `req-unplaced-${index}`,
      createdAt: 1, updatedAt: 1,
    })))
    expect(page.data.unplacedTotal).toBe(45)
    expect(page.data.unplacedFootprints).toHaveLength(20)
    page.onUnplacedLoadMore()
    expect(page.data.unplacedFootprints).toHaveLength(40)
  })

  it('keeps a first-page preview visible after the next page fails and replaces it on retry', async () => {
    const page = createPage()
    page.isVisible = true
    const first = {
      id: 'first-page', userId: 'test-user', status: 'visited', poiName: '先到的记录',
      lat: 31.23, lng: 121.47, photos: [], tags: [], source: 'manual',
      clientRequestId: 'first-page', createdAt: 1, updatedAt: 1,
    }
    repositoryMocks.listFootprints.mockImplementationOnce(async (options: any) => {
      options.onProgress([first], true)
      repositoryMocks.didFootprintCloudLoadFail.mockReturnValue(true)
      return []
    })
    await page.loadFootprints(true)
    expect(page.allFootprints.map((item: any) => item.id)).toEqual(['first-page'])
    expect(page.data.loading).toBe(false)
    expect(page.data.dataLoadFailed).toBe(true)
    repositoryMocks.didFootprintCloudLoadFail.mockReturnValue(false)
    repositoryMocks.listFootprints.mockResolvedValueOnce([first])
    await page.loadFootprints(true)
    expect(page.data.dataLoadFailed).toBe(false)
    expect(page.partialLoad).toBe(false)
  })
  it('requests the current position in visited mode before any footprints have loaded', async () => {
    vi.mocked(wx.getSetting).mockImplementation(({ success }: any) => success({ authSetting: {} }))
    vi.mocked(wx.getLocation).mockImplementation(({ success }: any) => success({ latitude: 31.2304, longitude: 121.4737 }))
    const page = createPage()
    page.onShow()
    await vi.waitFor(() => expect(page.data.center).toEqual({ latitude: 31.2304, longitude: 121.4737 }))
    expect(wx.getLocation).toHaveBeenCalledTimes(1)
  })

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

  it('marks visited cities on the lighting map without showing place or cluster pins', () => {
    const page = createPage()
    page.mapReady = true
    page.applyFootprints(Array.from({ length: 5 }, (_, index) => ({
      id: `shanghai-${index}`, userId: 'test-user', status: 'visited', poiName: `上海地点${index}`,
      province: '上海市', city: '上海市',
      lat: 31.23 + index * 0.001, lng: 121.47 + index * 0.001,
      photos: [], tags: [], source: 'manual', clientRequestId: `req-${index}`,
      createdAt: 1, updatedAt: 1,
    })))
    page.applyMode('lighting', { fit: true })
    expect(page.data.markers).toHaveLength(1)
    expect(page.data.markers[0]).toMatchObject({
      latitude: 31.2304, longitude: 121.4737,
      iconPath: '/assets/icons/map-marker-brand.png',
      callout: { content: '上海市', display: 'ALWAYS' },
    })
    expect(page.data.markers[0].isCluster).toBeUndefined()
    expect(page.data.provincePolygons.length).toBeGreaterThan(0)
    expect(page.data.scale).toBe(8)
    page.onMarkerTap({ detail: { markerId: page.data.markers[0].id } })
    expect(page.data.selectedProvince).toBe('上海市')
  })

  it('fits nearby lit cities so both remain visible instead of overlapping at a national scale', () => {
    const page = createPage()
    page.mapReady = true
    page.applyFootprints([
      { id: 'shanghai', status: 'visited', recordLevel: 'city', poiName: '上海', province: '上海市', city: '上海市', photos: [], tags: [], createdAt: 1, updatedAt: 1 },
      { id: 'nantong', status: 'visited', recordLevel: 'city', poiName: '南通', province: '江苏省', city: '南通市', photos: [], tags: [], createdAt: 1, updatedAt: 1 },
    ])
    page.applyMode('lighting', { fit: true })
    expect(page.data.markers.map((marker: any) => marker.callout.content).sort()).toEqual(['上海市', '南通市'].sort())
    expect(page.data.scale).toBe(9)
    expect(page.data.center.latitude).toBeCloseTo((31.2304 + 32.016212) / 2)
  })

  it('marks city-only stamps, excludes wishlisted cities, and does not mark the live location', () => {
    const page = createPage()
    page.mapReady = true
    page.applyFootprints([
      { id: 'nantong', status: 'visited', recordLevel: 'city', poiName: '南通', province: '江苏省', city: '南通市', photos: [], tags: [], createdAt: 1, updatedAt: 1 },
      { id: 'future', status: 'wishlist', recordLevel: 'city', poiName: '苏州', province: '江苏省', city: '苏州市', photos: [], tags: [], createdAt: 1, updatedAt: 1 },
    ])
    page.applyMode('lighting')
    expect(page.data.markers.map((marker: any) => marker.callout?.content)).toEqual(['南通市'])
    expect(page.data.markers[0]).toMatchObject({ latitude: 32.016212, longitude: 120.864608 })
    const wxml = readFileSync('miniprogram/pages/map/index.wxml', 'utf8')
    expect(wxml).toContain('show-location="{{false}}"')
    expect(wxml).toContain('src="/assets/icons/locate-white.png"')
  })

  it('renders a cluster as one count badge without a second visible pin', () => {
    const page = createPage()
    page.mapReady = true
    page.applyFootprints(Array.from({ length: 7 }, (_, index) => ({
      id: `cluster-${index}`, userId: 'test-user', status: 'visited', poiName: `地点${index}`,
      lat: 31.23 + index * 0.001, lng: 121.47 + index * 0.001,
      photos: [], tags: [], source: 'manual', clientRequestId: `cluster-req-${index}`,
      createdAt: 1, updatedAt: 1,
    })))
    page.zoomTier = 15
    page.refreshMarkers()
    const footprintIds = page.data.markers.map((marker: any) => marker.id)
    expect(footprintIds).toContain(1)

    page.zoomTier = 4
    page.refreshMarkers()
    const cluster = page.data.markers.find((marker: any) => marker.isCluster)
    expect(cluster).toMatchObject({
      count: 7,
      iconPath: '/assets/icons/map-marker-transparent.png',
      width: 44,
      height: 44,
      callout: { content: '7', display: 'ALWAYS' },
    })
    expect(footprintIds).not.toContain(cluster.id)
  })

  it('shows separate coastal places at wide zoom and restores the fitted viewport after a gesture', () => {
    const page = createPage()
    page.mapReady = true
    const positions = [
      [31.89815, 121.17393], [31.89296, 121.17055],
      [31.87297, 121.17919], [31.86935, 121.18214],
      [31.23247, 121.48700], [31.23162, 121.48461], [31.23040, 121.47370],
    ]
    page.applyFootprints(positions.map(([lat, lng], index) => ({
      id: `coast-${index}`, userId: 'test-user', status: 'visited', poiName: `地点${index}`,
      lat, lng, photos: [], tags: [], source: 'manual', clientRequestId: `coast-${index}`,
      createdAt: 1, updatedAt: 1,
    })), { fit: true })
    expect(page.data.scale).toBe(9)

    page.onRegionChange({ detail: { type: 'end', causedBy: 'update', scale: 4 } })
    expect(page.mapScale).toBe(9)

    page.onRegionChange({ detail: { type: 'end', causedBy: 'scale', scale: 4 } })
    expect(page.mapScale).toBe(4)
    expect(page.data.markers.filter((marker: any) => marker.isCluster).map((marker: any) => marker.count)).toEqual([4])
    expect(page.data.markers).toHaveLength(4)

    page.fitToFootprints(page.computeModeView('visited').modeList)
    expect(page.mapScale).toBe(9)
    expect(page.zoomTier).toBe(9)
  })

  it('focuses each wishlist card and labels city-only positions as approximate', () => {
    const page = createPage()
    page.mapReady = true
    page.applyFootprints([
      { id: 'beijing', userId: 'test-user', status: 'wishlist', poiName: '北京', province: '北京', city: '北京', photos: [], tags: [], source: 'manual', clientRequestId: 'bj', createdAt: 1, updatedAt: 1 },
      { id: 'nantong', userId: 'test-user', status: 'wishlist', poiName: '南通地点', province: '江苏', city: '南通', lat: 31.98, lng: 120.9, photos: [], tags: [], source: 'manual', clientRequestId: 'nt', createdAt: 1, updatedAt: 1 },
    ])
    page.applyMode('wishlist', { fit: true })
    expect(page.data.center).toEqual({ latitude: 39.9042, longitude: 116.4074 })
    expect(page.data.markers).toHaveLength(1)
    expect(page.data.markers[0]).toMatchObject({ title: '北京', latitude: 39.9042, longitude: 116.4074 })
    expect(page.data.markers[0].callout.content).toContain('城市范围')

    page.onUnplacedTap({ currentTarget: { dataset: { id: 'nantong' } } })
    expect(page.data.center).toEqual({ latitude: 31.98, longitude: 120.9 })
    expect(page.data.markers).toHaveLength(1)
    expect(page.data.markers[0].title).toBe('南通地点')
    expect(wx.navigateTo).not.toHaveBeenCalled()

    page.onUnplacedTap({ currentTarget: { dataset: { id: 'beijing' } } })
    expect(page.data.center).toEqual({ latitude: 39.9042, longitude: 116.4074 })
    page.onUnplacedEdit({ currentTarget: { dataset: { id: 'beijing' } } })
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/footprint-form/index?id=beijing' })
  })

  it('focuses a city-only wishlist when its data arrives after opening the map', () => {
    const page = createPage()
    page.applyMode('wishlist', { fit: true })
    expect(page.data.center).toEqual({ latitude: 35, longitude: 105 })
    page.applyFootprints([{ id: 'beijing', userId: 'test-user', status: 'wishlist', poiName: '北京', province: '北京', city: '北京', photos: [], tags: [], source: 'manual', clientRequestId: 'bj', createdAt: 1, updatedAt: 1 }])
    expect(page.data.center).toEqual({ latitude: 39.9042, longitude: 116.4074 })
    expect(page.data.selectedWishlistId).toBe('beijing')
  })

  it('moves city-only wishlist cards to their own city instead of a province or another footprint', () => {
    const page = createPage()
    page.mapReady = true
    page.applyFootprints([
      { id: 'nantong', status: 'wishlist', poiName: '南通', province: '江苏省', city: '南通市', photos: [], tags: [], createdAt: 1, updatedAt: 1 },
      { id: 'nanjing', status: 'wishlist', poiName: '南京', province: '江苏', city: '南京', photos: [], tags: [], createdAt: 1, updatedAt: 1 },
      { id: 'other', status: 'visited', poiName: '南通的另一条足迹', province: '江苏', city: '南通', lat: 31.5, lng: 120.1, photos: [], tags: [], createdAt: 1, updatedAt: 1 },
    ])
    page.applyMode('wishlist', { fit: true })
    expect(page.data.selectedWishlistId).toBe('nantong')
    expect(page.data.center).toEqual({ latitude: 32.016212, longitude: 120.864608 })
    expect(page.data.unplacedFootprints[0].locationLabel).toContain('城市范围')
    expect(page.data.markers[0].callout.content).toContain('城市范围')

    page.onUnplacedTap({ currentTarget: { dataset: { id: 'nanjing' } } })
    expect(page.data.center).toEqual({ latitude: 32.041544, longitude: 118.767413 })
    expect(page.data.selectedWishlistId).toBe('nanjing')
    expect(page.data.markers[0].title).toBe('南京')
  })

  it('keeps an unlocatable wishlist card unselected and offers to add its location', () => {
    const page = createPage()
    page.mapReady = true
    page.applyFootprints([
      { id: 'unknown', status: 'wishlist', poiName: '待定地点', province: '江苏', city: '', photos: [], tags: [], createdAt: 1, updatedAt: 1 },
      { id: 'beijing', status: 'wishlist', poiName: '北京', province: '北京', city: '北京', photos: [], tags: [], createdAt: 1, updatedAt: 1 },
    ])
    page.applyMode('wishlist', { fit: true })
    expect(page.data.selectedWishlistId).toBe('beijing')
    const center = page.data.center
    page.onUnplacedTap({ currentTarget: { dataset: { id: 'unknown' } } })
    expect(page.data.selectedWishlistId).toBe('beijing')
    expect(page.data.center).toEqual(center)
    expect(page.data.unplacedFootprints[0]).toMatchObject({ locationLabel: '待补充位置', canFocusOnMap: false })
    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({ title: '补充地图位置', confirmText: '补位置' }))
    const modalCalls = vi.mocked(wx.showModal).mock.calls
    const prompt = modalCalls[modalCalls.length - 1]?.[0] as any
    prompt.success({ confirm: true })
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/footprint-form/index?id=unknown' })

    const emptyPage = createPage()
    emptyPage.mapReady = true
    emptyPage.applyFootprints([
      { id: 'only-unknown', status: 'wishlist', poiName: '待定地点', province: '江苏', city: '', photos: [], tags: [], createdAt: 1, updatedAt: 1 },
    ])
    emptyPage.applyMode('wishlist', { fit: true })
    expect(emptyPage.data.selectedWishlistId).toBe('')
    expect(emptyPage.data.markers).toEqual([])
  })

  it('locates the user when switching from lighting to visited instead of fitting old footprints', async () => {
    vi.mocked(wx.getSetting).mockImplementation(({ success }: any) => success({ authSetting: { 'scope.userLocation': true } }))
    vi.mocked(wx.getLocation).mockImplementation(({ success }: any) => success({ latitude: 31.2304, longitude: 121.4737 }))
    const page = createPage()
    page.applyFootprints([{ id: 'old', userId: 'test-user', status: 'visited', poiName: '旧足迹', lat: 30.2741, lng: 120.1551, photos: [], tags: [], source: 'manual', clientRequestId: 'old', createdAt: 1, updatedAt: 1 }])
    page.applyMode('lighting', { fit: true })
    page.onModeTap({ currentTarget: { dataset: { mode: 'visited' } } })
    await vi.waitFor(() => expect(page.data.center).toEqual({ latitude: 31.2304, longitude: 121.4737 }))
    expect(page.data.scale).toBe(12)
    expect(page.data.mode).toBe('visited')
  })

  it('re-centers the native map on return even without a tab-entry flag or changed GPS coordinates', async () => {
    const moveToLocation = vi.fn()
    vi.mocked(wx.createMapContext).mockReturnValue({ moveToLocation } as any)
    vi.mocked(wx.getSetting).mockImplementation(({ success }: any) => success({ authSetting: { 'scope.userLocation': true } }))
    vi.mocked(wx.getLocation).mockImplementation(({ success }: any) => success({ latitude: 31.2304, longitude: 121.4737 }))
    const page = createPage()
    page.onReady()
    page.onShow()
    await vi.waitFor(() => expect(moveToLocation).toHaveBeenCalledTimes(1))
    page.onHide()
    page.onShow()
    await vi.waitFor(() => expect(moveToLocation).toHaveBeenCalledTimes(2))
    expect(wx.getLocation).toHaveBeenCalledTimes(2)
    expect(moveToLocation).toHaveBeenLastCalledWith({ latitude: 31.2304, longitude: 121.4737 })
    page.onUnload()
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

  it('does not let an in-flight location move the selected wishlist card away', async () => {
    let completeLocation!: (value: any) => void
    vi.mocked(wx.getLocation).mockImplementation(({ success }: any) => { completeLocation = success })
    const page = createPage()
    page.requestInitialLocation()
    page.applyFootprints([{ id: 'beijing', userId: 'test-user', status: 'wishlist', poiName: '北京', province: '北京', city: '北京', photos: [], tags: [], source: 'manual', clientRequestId: 'bj', createdAt: 1, updatedAt: 1 }])
    page.applyMode('wishlist', { fit: true })
    completeLocation({ latitude: 31.2304, longitude: 121.4737 })
    await Promise.resolve()
    await Promise.resolve()
    expect(page.data.center).toEqual({ latitude: 39.9042, longitude: 116.4074 })
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
    expect(page.data.center).toEqual({ latitude: 30.659462, longitude: 104.065735 })
    expect(page.data.scale).toBe(8)

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
