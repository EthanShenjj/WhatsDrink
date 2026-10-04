import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const repo = vi.hoisted(() => ({
  listFootprints: vi.fn(),
  getFootprint: vi.fn(),
  saveFootprint: vi.fn(),
}))
const trackProductEvent = vi.hoisted(() => vi.fn())
vi.mock('../miniprogram/services/repository', () => repo)
vi.mock('../miniprogram/services/product-events', () => ({ trackProductEvent }))

let definition: Record<string, any>
let storage: Record<string, unknown>
const createPage = () => ({
  ...definition,
  data: { ...definition.data },
  setData(patch: Record<string, unknown>, callback?: () => void) {
    Object.assign(this.data, patch)
    callback?.()
  },
}) as Record<string, any>

beforeAll(async () => {
  ;(globalThis as any).Page = (page: Record<string, any>) => { definition = page }
  ;(globalThis as any).wx = {
    getStorageSync: (key: string) => storage[key],
    setStorageSync: vi.fn((key: string, value: unknown) => { storage[key] = value }),
    switchTab: vi.fn(), navigateTo: vi.fn(), setNavigationBarTitle: vi.fn(), showToast: vi.fn(),
  }
  await import('../miniprogram/pages/city-stamp/index')
})

beforeEach(() => {
  storage = {}
  repo.listFootprints.mockReset().mockResolvedValue([])
  repo.getFootprint.mockReset()
  repo.saveFootprint.mockReset()
  trackProductEvent.mockReset()
  vi.mocked(wx.switchTab).mockReset()
  vi.mocked(wx.navigateTo).mockReset()
  vi.mocked(wx.showToast).mockReset()
})

describe('city stamp page', () => {
  it('saves a city without date, coordinates, photo, or location call and focuses its province', async () => {
    const page = createPage()
    page.onLoad({})
    page.onRegionChange({ detail: { value: ['四川省', '成都市', '锦江区'] } })
    repo.saveFootprint.mockImplementation(async (draft) => ({ ...draft, id: 'city-1' }))

    await page.onSave()

    expect(repo.saveFootprint).toHaveBeenCalledWith(expect.objectContaining({
      recordLevel: 'city', country: '中国', province: '四川', city: '成都',
      visitDate: undefined, photos: [],
    }))
    expect(repo.saveFootprint.mock.calls[0][0]).not.toHaveProperty('lat')
    expect(storage['sgj:map-mode']).toBe('lighting')
    expect(storage['sgj:city-stamp-target']).toBe('四川')
    expect(wx.switchTab).toHaveBeenCalledWith({ url: '/pages/map/index' })
    expect(trackProductEvent).toHaveBeenCalledWith('city_saved')
  })

  it('opens an existing city instead of saving a duplicate', async () => {
    const existing = { id: 'existing-city', recordLevel: 'city', status: 'visited', province: '北京', city: '北京' }
    repo.listFootprints.mockResolvedValue([existing])
    const page = createPage()
    page.onLoad({})
    page.onRegionChange({ detail: { value: ['北京市', '市辖区', '东城区'] } })
    await page.onSave()

    expect(page.data.id).toBe('existing-city')
    expect(repo.saveFootprint).not.toHaveBeenCalled()
    expect(trackProductEvent).not.toHaveBeenCalledWith('city_saved')
    expect(wx.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '这座城市已经点亮' }))
  })

  it('prefills a place from an already lit city', () => {
    const page = createPage()
    page.setData({ id: 'city-1', province: '香港', city: '香港' })
    page.onAddPlace()
    expect(storage['sgj:quick-place']).toEqual({ country: '中国', province: '香港', city: '香港' })
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/footprint-form/index?from=place' })
  })
})
