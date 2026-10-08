import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installUpdatePerformanceLogger, startPerformanceSpan } from '../miniprogram/utils/performance'

beforeEach(() => {
  ;(globalThis as any).wx = { getStorageSync: () => true, nextTick: (callback: () => void) => callback() }
})
afterEach(() => vi.restoreAllMocks())

describe('debug performance logging', () => {
  it('reports setData size and callback time without logging payload values', () => {
    const logs = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const host = {
      setData(_data: Record<string, unknown>, callback?: () => void) { callback?.() },
    }
    installUpdatePerformanceLogger(host, 'test-page')
    const callback = vi.fn()
    host.setData({ secret: 'private place name' }, callback)
    expect(callback).toHaveBeenCalledOnce()
    expect(logs).toHaveBeenCalledWith('[perf:setData]', expect.objectContaining({
      page: 'test-page', fields: 1, bytes: expect.any(Number),
    }))
    expect(JSON.stringify(logs.mock.calls)).not.toContain('private place name')
  })

  it('records numeric counts for a named span', () => {
    const logs = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const end = startPerformanceSpan('map.markers')
    end({ markers: 12 })
    expect(logs).toHaveBeenCalledWith('[perf:span]', expect.objectContaining({
      name: 'map.markers', markers: 12, elapsedMs: expect.any(Number),
    }))
  })
})
