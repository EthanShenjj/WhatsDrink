import { getFootprint, listFootprints, listTimeCapsules, listTravelPlans } from './repository'
import { APP_VERSION } from './config'
import type { TimeCapsule } from '../domain/types'

export const exportableCapsule = (capsule: TimeCapsule): TimeCapsule =>
  capsule.status === 'locked'
    ? { ...capsule, text: undefined, photos: [], subscriptionId: undefined }
    : { ...capsule, subscriptionId: undefined }

/** 图片保留文件引用，锁定胶囊不绕过时间锁。详情缺失时明确失败，避免导出残缺摘要。 */
export const buildDataExport = async (): Promise<string> => {
  const [list, travelPlans, capsules] = await Promise.all([
    listFootprints(), listTravelPlans(), listTimeCapsules(),
  ])
  const footprints = []
  for (let index = 0; index < list.length; index += 3) {
    const batch = await Promise.all(list.slice(index, index + 3).map(async (item) => {
      const detail = item.isSummary ? await getFootprint(item.id) : item
      if (!detail || detail.isSummary) throw new Error('部分记录详情未加载，请联网后重新导出')
      return detail
    }))
    footprints.push(...batch)
  }
  return JSON.stringify({
    format: 'shiguangji-data', schemaVersion: 1, appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    notes: '照片为文件引用，不包含图片文件；未解锁胶囊仅导出标题和日期。请妥善保存个人数据。',
    footprints, travelPlans, timeCapsules: capsules.map(exportableCapsule),
  }, null, 2)
}
