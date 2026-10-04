import { hasCloudAccess } from './repository'

export type ProductEvent =
  | 'first_open'
  | 'city_picker_opened'
  | 'city_saved'
  | 'province_card_opened'
  | 'place_added'
  | 'old_record_opened'
  | 'album_saved'

const EVENT_STORAGE_KEY = 'sgj:product-events-pending'
const FIRST_OPEN_KEY = 'sgj:first-open-tracked'
type EventEntry = { id: string; action: ProductEvent; at: number }
let flushing = false

const pending = (): EventEntry[] => {
  try {
    const entries = wx.getStorageSync<EventEntry[]>(EVENT_STORAGE_KEY)
    return Array.isArray(entries) ? entries : []
  } catch { return [] }
}

/** 只上报动作和时间；不接收地点、文字、照片或坐标参数。 */
export const trackProductEvent = (action: ProductEvent): void => {
  try {
    const at = Date.now()
    const suffix = Math.random().toString(36).slice(2).padEnd(10, '0').slice(0, 10)
    wx.setStorageSync(EVENT_STORAGE_KEY, [...pending(), { id: `${at}_${suffix}`, action, at }].slice(-50))
    void flushProductEvents().catch(() => undefined)
  } catch { /* 统计失败不得阻断核心记录。 */ }
}

export const trackFirstOpen = (): void => {
  try {
    if (wx.getStorageSync(FIRST_OPEN_KEY)) return
    wx.setStorageSync(FIRST_OPEN_KEY, true)
    trackProductEvent('first_open')
  } catch { /* 本地存储不可用时跳过统计。 */ }
}

export const flushProductEvents = async (): Promise<void> => {
  if (flushing || !hasCloudAccess() || !wx.cloud) return
  const queued = pending()
  const fresh = queued.filter((event) => Date.now() - event.at <= 30 * 86_400_000)
  if (fresh.length !== queued.length) {
    try { wx.setStorageSync(EVENT_STORAGE_KEY, fresh) } catch { return }
  }
  const batch = fresh.slice(0, 30)
  if (!batch.length) return
  flushing = true
  let sent = false
  try {
    const response = await wx.cloud.callFunction({ name: 'productEvents', data: { events: batch } })
    const result = response.result as { ok?: boolean }
    if (result?.ok) {
      sent = true
      const current = pending()
      // 发送期间新增的事件仍留在队列里。
      const sentIds = new Set(batch.map((event) => event.id))
      wx.setStorageSync(EVENT_STORAGE_KEY, current.filter((event) => !sentIds.has(event.id)))
    }
  } catch { /* 离线或云函数未部署时，保留有限队列下次再试。 */ }
  finally {
    flushing = false
    if (sent && pending().length) setTimeout(() => { void flushProductEvents().catch(() => undefined) }, 0)
  }
}
