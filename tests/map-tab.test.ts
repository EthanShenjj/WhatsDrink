import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let definition: any
let storage: Record<string, unknown>
const locate = vi.fn()

beforeAll(async () => {
  ;(globalThis as any).Component = (options: any) => { definition = options }
  ;(globalThis as any).getCurrentPages = () => [{ onLocate: locate }]
  ;(globalThis as any).wx = {
    setStorageSync: vi.fn((key: string, value: unknown) => { storage[key] = value }),
    removeStorageSync: vi.fn((key: string) => { delete storage[key] }),
    switchTab: vi.fn(),
  }
  await import('../miniprogram/custom-tab-bar/index')
})

beforeEach(() => {
  storage = {}
  locate.mockReset()
  vi.mocked(wx.switchTab).mockReset()
})

const createTab = (selected: number) => ({
  ...definition.methods,
  data: { ...definition.data, selected },
  setData(patch: Record<string, unknown>) { Object.assign(this.data, patch) },
})

describe('map tab location intent', () => {
  it('signals that an explicit switch should refresh the user position', () => {
    const tab = createTab(3)
    tab.switchTab({ currentTarget: { dataset: { index: 0 } } })
    expect(storage['sgj:map-tab-entry']).toBe(true)
    expect(wx.switchTab).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/map/index' }))
    expect(tab.data.selected).toBe(0)
  })

  it('locates again when tapping an already selected map tab', () => {
    const tab = createTab(0)
    tab.switchTab({ currentTarget: { dataset: { index: 0 } } })
    expect(locate).toHaveBeenCalledOnce()
    expect(wx.switchTab).not.toHaveBeenCalled()
  })

  it('clears a stale location intent when switching fails', () => {
    vi.mocked(wx.switchTab).mockImplementation(({ fail }: any) => fail({ errMsg: 'switchTab:fail' }))
    const tab = createTab(3)
    tab.switchTab({ currentTarget: { dataset: { index: 0 } } })
    expect(storage['sgj:map-tab-entry']).toBeUndefined()
    expect(tab.data.selected).toBe(3)
  })

  it('hides the native map shortcut for the whole record-sheet animation', () => {
    vi.useFakeTimers()
    const visibility = vi.fn()
    ;(globalThis as any).getCurrentPages = () => [{
      route: 'pages/map/index',
      onRecordSheetVisibilityChange: visibility,
    }]
    try {
      const tab = createTab(0)
      tab.switchTab({ currentTarget: { dataset: { index: 2 } } })
      expect(tab.data.sheetVisible).toBe(true)
      expect(tab.data.hidden).toBe(true)
      expect(visibility).toHaveBeenCalledWith(true)
      tab.closeSheet()
      expect(tab.data.sheetClosing).toBe(true)
      expect(visibility).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(260)
      expect(tab.data.sheetClosing).toBe(false)
      expect(tab.data.hidden).toBe(false)
      expect(visibility).toHaveBeenLastCalledWith(false)
    } finally {
      vi.useRealTimers()
      ;(globalThis as any).getCurrentPages = () => [{ onLocate: locate }]
    }
  })
})
