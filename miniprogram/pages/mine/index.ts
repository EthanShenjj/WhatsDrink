import type { GrowthSnapshot, LightingStats, UserProfile } from '../../domain/types'
import {
  ensureProfile,
  listFootprints,
  clearAllData,
} from '../../services/repository'
import { computeLighting } from '../../utils/footprint'
import { computeGrowthSnapshot } from '../../utils/growth'

interface MenuRow {
  key: string
  label: string
  hint?: string
  icon: string
}

interface PageData {
  profile: UserProfile | null
  isLoggedIn: boolean
  stats: LightingStats | null
  growth: GrowthSnapshot | null
  loginSheetVisible: boolean
  menu: MenuRow[]
  version: string
  clearing: boolean
  loading: boolean
}

const app = getApp<IAppOption>()

const MENU: MenuRow[] = [
  { key: 'settings', label: '地图设置', icon: 'settings' },
  { key: 'explore', label: '探索与轻攻略', hint: 'P1', icon: 'compass' },
  { key: 'export', label: '数据导出', hint: 'P1', icon: 'download' },
  { key: 'privacy', label: '隐私设置', icon: 'lock' },
  { key: 'capsule', label: '时光胶囊', icon: 'clock' },
  { key: 'about', label: '关于拾光迹', icon: 'sparkles' },
]

Page<PageData, WechatMiniprogram.IAnyObject>({
  data: {
    profile: null,
    isLoggedIn: false,
    stats: null,
    growth: null,
    loginSheetVisible: false,
    menu: MENU,
    version: '1.0.0',
    clearing: false,
    loading: true,
  },

  onShow() {
    const tabBar = this.getTabBar?.()
    if (tabBar) tabBar.setData({ selected: 3 })
    this.loadProfileAndStats()
  },

  async loadProfileAndStats() {
    this.setData({ loading: true })
    try {
      const profile = await ensureProfile()
      app.globalData.profile = profile
      const isLoggedIn = Boolean(profile && profile.nickname && profile.avatarUrl)
      // refresh cache if stale
      let list = app.globalData.footprints || []
      const cachedAt = app.globalData.footprintsCachedAt || 0
      if (!list.length || Date.now() - cachedAt > 60_000) {
        try {
          list = await listFootprints()
          app.globalData.footprints = list
          app.globalData.footprintsCachedAt = Date.now()
        } catch (err) {
          console.warn('[mine] load footprints failed', err)
        }
      }
      const stats = computeLighting(list)
      const growth = computeGrowthSnapshot(list, profile)
      this.setData({ profile, isLoggedIn, stats, growth, loading: false })
    } catch (err) {
      console.warn('[mine] load failed', err)
      this.setData({ loading: false })
    }
  },

  onLoginTap() {
    if (this.data.isLoggedIn) {
      wx.navigateTo({ url: '/pages/mine-edit/index' })
      return
    }
    this.setData({ loginSheetVisible: true })
  },

  async onLoginSuccess(e: WechatMiniprogram.CustomEvent<{ profile: UserProfile }>) {
    const profile = e.detail.profile
    app.globalData.profile = profile
    this.setData({
      profile,
      isLoggedIn: true,
      loginSheetVisible: false,
    })
    wx.showToast({ title: '资料已完善', icon: 'success' })
  },

  onLoginCancel() {
    this.setData({ loginSheetVisible: false })
  },

  onAnnualReview() {
    wx.navigateTo({ url: `/pages/share-card/index?type=map&year=${new Date().getFullYear()}` })
  },

  onGrowthTap() {
    wx.navigateTo({ url: '/pages/growth/index' })
  },

  onMenuTap(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key || '')
    switch (key) {
      case 'settings':
        wx.navigateTo({ url: '/pages/settings/index' })
        break
      case 'explore':
        wx.navigateTo({ url: '/pages/guide/index' })
        break
      case 'export':
        wx.showToast({ title: '功能开发中', icon: 'none' })
        break
      case 'privacy':
        wx.navigateTo({ url: '/pages/privacy/index' })
        break
      case 'capsule':
        wx.navigateTo({ url: '/pages/time-capsule/index' })
        break
      case 'about':
        this.showAbout()
        break
      default:
        break
    }
  },

  showAbout() {
    wx.showModal({
      title: '关于拾光迹',
      content: `拾光迹 Shiguangji\n版本 ${this.data.version}\n\n记录你去过的每一个地方，点亮你的足迹地图。`,
      showCancel: false,
      confirmText: '我知道了',
    })
  },

  async onClearAll() {
    if (this.data.clearing) return
    const confirmed = await this.confirmDialog({
      title: '清除所有数据',
      content: '将删除所有足迹、照片和攻略，且无法恢复。确定继续吗？',
      confirmText: '确认清除',
      confirmColor: '#3E47C8',
    })
    if (!confirmed) return
    this.setData({ clearing: true })
    try {
      await clearAllData()
      app.globalData.footprints = []
      app.globalData.footprintsCachedAt = Date.now()
      this.setData({
        stats: computeLighting([]),
        growth: computeGrowthSnapshot([], this.data.profile),
        clearing: false,
      })
      wx.showToast({ title: '已清除所有数据', icon: 'success' })
    } catch (err) {
      console.warn('[mine] clear failed', err)
      wx.showToast({ title: '操作失败，请重试', icon: 'none' })
      this.setData({ clearing: false })
    }
  },

  confirmDialog(opts: {
    title: string
    content: string
    confirmText?: string
    confirmColor?: string
  }): Promise<boolean> {
    return new Promise((resolve) => {
      wx.showModal({
        title: opts.title,
        content: opts.content,
        confirmText: opts.confirmText || '确认',
        confirmColor: opts.confirmColor || '#3E47C8',
        cancelText: '取消',
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false),
      })
    })
  },
})
