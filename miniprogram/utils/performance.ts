const PERF_DEBUG_KEY = 'sgj:perf-debug'

const enabled = (): boolean => {
  try {
    return Boolean(wx.getStorageSync(PERF_DEBUG_KEY))
  } catch {
    return false
  }
}

export const isPerformanceDebugEnabled = enabled

/** 单调时钟优先，日志只记录阶段、耗时与非敏感的数量。 */
const now = (): number => typeof performance !== 'undefined' && performance.now
  ? performance.now() : Date.now()

export const startPerformanceSpan = (name: string): ((counts?: Record<string, number>) => void) => {
  if (!enabled()) return () => undefined
  const startedAt = now()
  return (counts = {}) => {
    console.info('[perf:span]', {
      name,
      elapsedMs: Math.round((now() - startedAt) * 10) / 10,
      ...counts,
    })
  }
}

export const measureAsync = async <T>(
  name: string,
  operation: () => Promise<T>,
  counts?: (result: T) => Record<string, number>,
): Promise<T> => {
  const end = startPerformanceSpan(name)
  try {
    const result = await operation()
    end(counts?.(result))
    return result
  } catch (error) {
    end({ failed: 1 })
    throw error
  }
}

type UpdateListenerHost = {
  setData?: (data: Record<string, unknown>, callback?: () => void) => void
  setUpdatePerformanceListener?: (
    options: { withDataPaths: true },
    callback: (result: {
      dataPaths?: string[]
      pendingStartTimestamp: number
      updateStartTimestamp: number
      updateEndTimestamp: number
    }) => void,
  ) => void
}

/** 仅调试开关开启时输出字段数量、排队时间和渲染计算时间。 */
export const installUpdatePerformanceLogger = (
  host: UpdateListenerHost,
  page: string,
): void => {
  if (!enabled()) return
  if (typeof host.setData === 'function') {
    const original = host.setData
    try {
      host.setData = (data, callback) => {
        const startedAt = now()
        const bytes = JSON.stringify(data).length
        original.call(host, data, () => {
          console.info('[perf:setData]', {
            page,
            fields: Object.keys(data).length,
            bytes,
            callbackMs: Math.round(now() - startedAt),
          })
          callback?.()
        })
      }
    } catch {
      // 某些基础库不允许覆写 Page.setData；保留原方法和下方原生性能监听。
    }
  }
  if (typeof host.setUpdatePerformanceListener !== 'function') return
  host.setUpdatePerformanceListener({ withDataPaths: true }, (result) => {
    console.info('[perf:update]', {
      page,
      fields: result.dataPaths?.length || 0,
      waitingMs: result.updateStartTimestamp - result.pendingStartTimestamp,
      updateMs: result.updateEndTimestamp - result.updateStartTimestamp,
    })
  })
}

/** 记录点击进入逻辑层、下一次视图刷新和短暂稳定三个时间点。 */
export const recordInteraction = (name: string): void => {
  if (!enabled()) return
  const startedAt = now()
  console.info('[perf:interaction]', { name, phase: 'received', elapsedMs: 0 })
  wx.nextTick(() => {
    console.info('[perf:interaction]', { name, phase: 'nextTick', elapsedMs: Math.round(now() - startedAt) })
  })
}
