const PERF_DEBUG_KEY = 'sgj:perf-debug'

const enabled = (): boolean => {
  try {
    return Boolean(wx.getStorageSync(PERF_DEBUG_KEY))
  } catch {
    return false
  }
}

type UpdateListenerHost = {
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
  if (!enabled() || typeof host.setUpdatePerformanceListener !== 'function') return
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
  const startedAt = Date.now()
  console.info('[perf:interaction]', { name, phase: 'received', elapsedMs: 0 })
  wx.nextTick(() => {
    console.info('[perf:interaction]', { name, phase: 'nextTick', elapsedMs: Date.now() - startedAt })
  })
  setTimeout(() => {
    console.info('[perf:interaction]', { name, phase: 'settled', elapsedMs: Date.now() - startedAt })
  }, 250)
}

