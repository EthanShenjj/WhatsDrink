import type { Footprint } from '../../domain/types'
import { getFootprint, listFootprints, saveFootprint } from '../../services/repository'
import { citySelection, CITY_STAMP_TARGET_STORAGE_KEY } from '../../utils/location'
import { trackProductEvent } from '../../services/product-events'

const MAP_MODE_STORAGE_KEY = 'sgj:map-mode'

interface PageData {
  id: string
  province: string
  city: string
  visitDate: string
  today: string
  saving: boolean
}

Page<PageData, WechatMiniprogram.IAnyObject>({
  data: { id: '', province: '', city: '', visitDate: '', today: '', saving: false },

  onLoad(query: Record<string, string>) {
    trackProductEvent(query.id ? 'old_record_opened' : 'city_picker_opened')
    const now = new Date()
    this.setData({ today: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` })
    if (query.id) {
      void getFootprint(query.id).then((record) => {
        if (!record || record.recordLevel !== 'city') return
        this.showExisting(record)
      }).catch(() => wx.showToast({ title: '城市记录暂时无法打开', icon: 'none' }))
    }
  },

  showExisting(record: Footprint) {
    this.setData({ id: record.id, province: record.province || '', city: record.city || '', visitDate: record.visitDate || '' })
    wx.setNavigationBarTitle({ title: `${record.city || '城市'}已点亮` })
  },

  onRegionChange(event: WechatMiniprogram.PickerChange) {
    const values = event.detail.value
    if (!Array.isArray(values)) return
    const { province, city } = citySelection(values.map(String))
    this.setData({ province, city })
  },

  onDateChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ visitDate: String(event.detail.value || '') })
  },

  onClearDate() { this.setData({ visitDate: '' }) },

  showOnMap() {
    wx.setStorageSync(MAP_MODE_STORAGE_KEY, 'lighting')
    wx.setStorageSync(CITY_STAMP_TARGET_STORAGE_KEY, this.data.province)
    wx.switchTab({ url: '/pages/map/index' })
  },

  async onSave() {
    if (this.data.saving || !this.data.province || !this.data.city) return
    if (this.data.id) { this.showOnMap(); return }
    this.setData({ saving: true })
    try {
      const records = await listFootprints()
      const existing = records.find((record) => record.status === 'visited' && record.recordLevel === 'city'
        && record.province === this.data.province && record.city === this.data.city)
      if (existing) {
        this.showExisting(existing)
        wx.showToast({ title: '这座城市已经点亮', icon: 'none' })
        return
      }
      const saved = await saveFootprint({
        status: 'visited', recordLevel: 'city', poiName: this.data.city,
        country: '中国', province: this.data.province, city: this.data.city,
        visitDate: this.data.visitDate || undefined,
        photos: [], tags: [], source: 'manual',
      })
      this.showExisting(saved)
      trackProductEvent('city_saved')
      wx.showToast({ title: saved.pendingSync ? '已保存，联网后同步' : '城市已点亮', icon: 'none' })
      this.showOnMap()
    } catch {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  onAddPlace() {
    wx.setStorageSync('sgj:quick-place', { country: '中国', province: this.data.province, city: this.data.city })
    wx.navigateTo({ url: '/pages/footprint-form/index?from=place' })
  },
})
