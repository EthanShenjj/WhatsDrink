import type { DrinkRecord } from '../../domain/types'
import { listRecords } from '../../services/repository'
import { dateKey, homeDateText, summarizeRecords, timeText } from '../../utils/date'

interface RecordView extends DrinkRecord {
  timeText: string
  calorieText: string
  fallbackImage: string
}

Page({
  data: {
    dateText: '',
    records: [] as RecordView[],
    count: 0,
    knownCalories: 0,
    unknownCaloriesCount: 0,
    loading: true,
  },
  onShow() {
    const tabBar = this.getTabBar?.()
    tabBar?.setData({ selected: 0 })
    this.loadData()
  },
  async loadData() {
    this.setData({ loading: true, dateText: homeDateText() })
    try {
      const todayKey = dateKey(new Date())
      const records = (await listRecords()).filter((record) => dateKey(record.consumedAt) === todayKey)
      const summary = summarizeRecords(records)
      const view = records.map<RecordView>((record) => ({
        ...record,
        timeText: timeText(record.consumedAt),
        calorieText:
          typeof record.calorieKcal === 'number' ? `${record.calorieKcal} 千卡` : '热量未填写',
        fallbackImage:
          record.category === 'coffee' ? '/assets/coconut-latte.jpg' : '/assets/milk-tea.jpg',
      }))
      this.setData({ records: view, ...summary })
    } catch {
      wx.showToast({ title: '记录加载失败，请重试', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  addRecord() {
    wx.navigateTo({ url: '/pages/record-form/index' })
  },
  editRecord(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id)
    wx.navigateTo({ url: `/pages/record-form/index?id=${encodeURIComponent(id)}` })
  },
  openChoice() {
    wx.switchTab({ url: '/pages/choice/index' })
  },
})
