import type { MapSettings } from '../../domain/types'
import { getMapSettings, saveMapSettings } from '../../services/repository'

const MARKER_OPTIONS: Array<{ value: MapSettings['markerStyle']; label: string; hint: string; preview: string }> = [
  { value: 'dot', label: '色点', hint: '轻量清晰', preview: '●' },
  { value: 'emoji', label: 'Emoji', hint: '更有情绪', preview: '🌿' },
  { value: 'label', label: '名称标签', hint: '放大后可读', preview: '地点' },
]

const THEME_OPTIONS: Array<{ value: MapSettings['theme']; label: string; hint: string }> = [
  { value: 'clean', label: '清爽地图', hint: '干净、适合日常浏览' },
  { value: 'journal', label: '手账地图', hint: '暖色纸张与回忆感' },
  { value: 'night', label: '夜间地图', hint: '低亮度环境更舒适' },
]

Page({
  data: {
    settings: getMapSettings(),
    markerOptions: MARKER_OPTIONS,
    themeOptions: THEME_OPTIONS,
  },

  selectMarker(e: WechatMiniprogram.TouchEvent) {
    const markerStyle = e.currentTarget.dataset.value as MapSettings['markerStyle']
    this.setData({ 'settings.markerStyle': markerStyle })
    this.persist()
  },

  selectTheme(e: WechatMiniprogram.TouchEvent) {
    const theme = e.currentTarget.dataset.value as MapSettings['theme']
    this.setData({ 'settings.theme': theme })
    this.persist()
  },

  toggleCluster(e: WechatMiniprogram.SwitchChange) {
    this.setData({ 'settings.clusterEnabled': e.detail.value })
    this.persist()
  },

  persist() {
    saveMapSettings(this.data.settings)
    wx.showToast({ title: '已保存', icon: 'none', duration: 800 })
  },
})
