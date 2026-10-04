import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const repositoryMocks = vi.hoisted(() => ({
  saveFootprint: vi.fn(),
  fulfillWishlistFootprint: vi.fn(),
  getFootprintSnapshot: vi.fn(),
  deleteFootprint: vi.fn(),
  getFootprint: vi.fn(),
  uploadFootprintPhoto: vi.fn(),
  deletePhotos: vi.fn(),
  saveDraft: vi.fn(),
  loadDraft: vi.fn(() => null),
  clearDraft: vi.fn(),
}))

vi.mock('../miniprogram/services/repository', () => repositoryMocks)
vi.mock('../miniprogram/utils/performance', () => ({
  installUpdatePerformanceLogger: vi.fn(),
  recordInteraction: vi.fn(),
}))

type PageDefinition = Record<string, any> & { data: Record<string, any> }

let definition: PageDefinition
let storage: Record<string, unknown>

const createPage = (): PageDefinition => ({
  ...definition,
  data: { ...definition.data },
  setData(patch: Record<string, unknown>, callback?: () => void) {
    Object.assign(this.data, patch)
    callback?.()
  },
})

beforeAll(async () => {
  ;(globalThis as any).Page = (options: PageDefinition) => {
    definition = options
  }
  ;(globalThis as any).wx = {
    getStorageSync: vi.fn((key: string) => storage[key]),
    setStorageSync: vi.fn((key: string, value: unknown) => { storage[key] = value }),
    removeStorageSync: vi.fn((key: string) => { delete storage[key] }),
    setNavigationBarTitle: vi.fn(),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    showToast: vi.fn(),
    chooseLocation: vi.fn(),
    showModal: vi.fn(),
    vibrateShort: vi.fn(),
  }
  ;(globalThis as any).getCurrentPages = () => []
  await import('../miniprogram/pages/footprint-form/index')
})

beforeEach(() => {
  storage = {}
  repositoryMocks.getFootprint.mockReset()
  repositoryMocks.loadDraft.mockReturnValue(null)
  vi.mocked(wx.showLoading).mockReset()
  vi.mocked(wx.hideLoading).mockReset()
  repositoryMocks.saveFootprint.mockReset()
})

describe('check-in form handoff', () => {
  it('preserves failed photos when the user selects more photos', async () => {
    const page = createPage()
    page.setData({ pendingUploads: ['wxfile://failed.jpg'], uploadFailedCount: 1 })
    repositoryMocks.uploadFootprintPhoto.mockResolvedValueOnce({ photo: 'cloud://new', thumbnail: 'cloud://new-thumb' })
    await page.uploadPhotos(['wxfile://new.jpg'])
    expect(page.data.photos).toEqual(['cloud://new'])
    expect(page.data.pendingUploads).toEqual(['wxfile://failed.jpg'])
    expect(page.data.uploadFailedCount).toBe(1)
    page.onPhotoRemove({ detail: { index: -1, pendingIndex: 0 } })
    expect(page.data.pendingUploads).toEqual([])
    expect(page.data.uploadFailedCount).toBe(0)
  })
  it('replaces stale administrative metadata and place group when a location changes', () => {
    const page = createPage()
    page.setData({ placeId: 'shanghai-group', poiName: '上海地点', lat: 31.2, lng: 121.4, province: '上海', city: '上海' })
    vi.mocked(wx.chooseLocation).mockImplementation(({ success }: any) => success({ name: '杭州地点', address: '浙江省杭州市西湖区测试路', latitude: 30.2741, longitude: 120.1551 }))
    page.onChooseLocation()
    expect(page.data.placeId).toBeUndefined()
    expect(page.data).toMatchObject({ country: '中国', province: '浙江', city: '杭州', district: '西湖区' })
  })

  it('allows manual records without location and makes the success message honest', async () => {
    const page = createPage()
    page.setData({ poiName: '未定位的回忆', visitDate: '2026-10-01' })
    repositoryMocks.saveFootprint.mockImplementation(async (draft: any) => ({ ...draft, id: 'unplaced' }))
    await page.onSave()
    expect(repositoryMocks.saveFootprint).toHaveBeenCalled()
    expect(page.data.successTitle).toBe('已留下这段记录')
  })

  it('retains the same transaction identity after a failed save', async () => {
    const page = createPage()
    page.setData({ poiName: '测试地点', visitDate: '2026-10-01' })
    repositoryMocks.saveFootprint.mockRejectedValue(new Error('network timeout'))
    await page.onSave()
    await page.onSave()
    const [first, second] = repositoryMocks.saveFootprint.mock.calls
    expect(first[0].clientRequestId).toBeTruthy()
    expect(first[0].clientRequestId).toBe(second[0].clientRequestId)
  })

  it('still requires a location for an actual check-in', async () => {
    const page = createPage()
    page.setData({ isCheckin: true, poiName: '打卡地点', visitDate: '2026-10-01' })
    await page.onSave()
    expect(repositoryMocks.saveFootprint).not.toHaveBeenCalled()
  })

  it('hydrates immediately from the map snapshot without fetching cloud detail', () => {
    storage['sgj:checkin-source'] = {
      id: 'nearby',
      userId: 'test-user',
      status: 'visited',
      poiName: '附近足迹',
      address: '测试路 1 号',
      lat: 31.2304,
      lng: 121.4737,
      photos: [],
      tags: ['散步'],
      source: 'manual',
      clientRequestId: 'req-nearby',
      createdAt: 1,
      updatedAt: 1,
    }
    const page = createPage()

    page.onLoad({ revisit: 'nearby', checkin: '1', distance: '12' })

    expect(repositoryMocks.getFootprint).not.toHaveBeenCalled()
    expect(wx.showLoading).not.toHaveBeenCalled()
    expect(page.data.poiName).toBe('附近足迹')
    expect(page.data.isCheckin).toBe(true)
    expect(page.data.checkinDistance).toBe(12)
    expect(storage['sgj:checkin-source']).toBeUndefined()
  })
})
