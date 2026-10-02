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
  }
  await import('../miniprogram/pages/footprint-form/index')
})

beforeEach(() => {
  storage = {}
  repositoryMocks.getFootprint.mockReset()
  repositoryMocks.loadDraft.mockReturnValue(null)
  vi.mocked(wx.showLoading).mockReset()
  vi.mocked(wx.hideLoading).mockReset()
})

describe('check-in form handoff', () => {
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
