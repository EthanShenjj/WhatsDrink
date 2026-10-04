import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const repo = vi.hoisted(() => ({ listFootprints: vi.fn() }))
const trackProductEvent = vi.hoisted(() => vi.fn())
vi.mock('../miniprogram/services/repository', () => repo)
vi.mock('../miniprogram/services/product-events', () => ({ trackProductEvent }))

let definition: Record<string, any>
let page: Record<string, any>
const words: string[] = []
const drawImage = vi.fn()
const canvas = {
  width: 0, height: 0,
  getContext: () => context,
  createImage: () => {
    const image: Record<string, any> = { onload: null, onerror: null }
    Object.defineProperty(image, 'src', { set: () => queueMicrotask(() => image.onload?.()) })
    return image
  },
}
const context = {
  fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left',
  fillRect: vi.fn(), fillText: (word: string) => words.push(word),
  beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
  fill: vi.fn(), stroke: vi.fn(), setTransform: vi.fn(), drawImage,
}
const record = (id: string, patch: Record<string, unknown> = {}) => ({
  id, userId: 'user', status: 'visited', recordLevel: 'place', poiName: '私人地点',
  country: '中国', province: '四川', city: '成都', photos: [], tags: [], source: 'manual',
  clientRequestId: id, createdAt: 1, updatedAt: 1, ...patch,
})

beforeAll(async () => {
  ;(globalThis as any).Page = (definitionValue: Record<string, any>) => { definition = definitionValue }
  ;(globalThis as any).wx = {
    createSelectorQuery: () => ({
      in() { return this }, select() { return this }, fields() { return this },
      exec(callback: (result: unknown[]) => void) { callback([{ node: canvas, width: 343, height: 460 }]) },
    }),
    getWindowInfo: () => ({ pixelRatio: 3 }),
    canvasToTempFilePath: vi.fn(({ success }) => success({ tempFilePath: 'wxfile://private-card.png' })),
    saveImageToPhotosAlbum: vi.fn(({ success }) => success()),
    showToast: vi.fn(), showModal: vi.fn(), openSetting: vi.fn(),
  }
  await import('../miniprogram/pages/city-album/index')
})

beforeEach(() => {
  words.length = 0
  drawImage.mockReset()
  repo.listFootprints.mockReset().mockResolvedValue([
    record('city', { recordLevel: 'city', poiName: '成都', photos: [], visitDate: undefined }),
    record('place', { note: '只给自己看的文字', photos: ['wxfile://private-photo.jpg'] }),
  ])
  trackProductEvent.mockReset()
  vi.mocked(wx.canvasToTempFilePath).mockReset().mockImplementation(({ success }: any) => success({ tempFilePath: 'wxfile://private-card.png' }))
  vi.mocked(wx.saveImageToPhotosAlbum).mockReset().mockImplementation(({ success }: any) => success())
  vi.mocked(wx.showModal).mockReset()
  vi.mocked(wx.openSetting).mockReset()
  page = {
    ...definition,
    data: { ...definition.data },
    setData(patch: Record<string, unknown>, callback?: () => void) { Object.assign(this.data, patch); callback?.() },
  }
})

describe('private city album', () => {
  it('keeps place, photo, and note out of the default image', async () => {
    await page.onReady()
    expect(page.data.cityCount).toBe(1)
    expect(page.data.includePlaces).toBe(false)
    expect(page.data.includePhoto).toBe(false)
    expect(page.data.includeNotes).toBe(false)
    expect(words.join(' ')).not.toContain('私人地点')
    expect(words.join(' ')).not.toContain('只给自己看的文字')
    expect(drawImage).not.toHaveBeenCalled()
    page.onSave()
    expect(wx.saveImageToPhotosAlbum).toHaveBeenCalledWith(expect.objectContaining({ filePath: 'wxfile://private-card.png' }))
    expect(trackProductEvent).toHaveBeenCalledWith('album_saved')
  })

  it('adds private content only after the matching controls are enabled', async () => {
    await page.onReady()
    words.length = 0
    page.togglePlaces({ detail: { value: true } })
    expect(words.join(' ')).toContain('私人地点')
    expect(words.join(' ')).not.toContain('只给自己看的文字')
    page.toggleNotes({ detail: { value: true } })
    expect(words.join(' ')).toContain('只给自己看的文字')
    page.togglePhoto({ detail: { value: true } })
    await vi.waitFor(() => expect(page.data.rendering).toBe(false))
    expect(drawImage).toHaveBeenCalledOnce()
  })

  it('handles denied album permission without logging a successful save', async () => {
    await page.onReady()
    vi.mocked(wx.saveImageToPhotosAlbum).mockImplementation(({ fail }: any) => fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' }))
    vi.mocked(wx.showModal).mockImplementation(({ success }: any) => success({ confirm: true }))
    page.onSave()
    expect(wx.openSetting).toHaveBeenCalled()
    expect(trackProductEvent).not.toHaveBeenCalledWith('album_saved')
    expect(page.data.saving).toBe(false)
  })
})
