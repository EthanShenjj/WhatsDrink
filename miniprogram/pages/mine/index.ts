import type { GrowthSnapshot, LightingStats, UserProfile } from '../../domain/types'
import {
  ensureProfile,
  listFootprints,
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
  menu: MenuRow[]
  version: string
  loading: boolean
}

const app = getApp<IAppOption>()

const MENU: MenuRow[] = [
  { key: 'membership', label: '拾光+ 与购买记录', icon: 'sparkles' },
  { key: 'settings', label: '地图设置', icon: 'settings' },
  { key: 'explore', label: '探索与轻攻略', hint: 'P1', icon: 'compass' },
  { key: 'capsule', label: '时光胶囊', icon: 'clock' },
  { key: 'about', label: '关于拾光迹', icon: 'sparkles' },
]

Page<PageData, WechatMiniprogram.IAnyObject>({
  data: {
    profile: null,
    isLoggedIn: false,
    stats: null,
    growth: null,
    menu: MENU,
    version: '1.0.0',
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

  onProfileTap() {
    wx.navigateTo({ url: '/pages/personal-settings/index' })
  },

  onAnnualReview() {
    wx.navigateTo({ url: `/pages/share-card/index?type=map&year=${new Date().getFullYear()}` })
  },

  onGrowthTap() {
    wx.navigateTo({ url: '/pages/growth/index' })
  },

  onMembershipTap() {
    wx.navigateTo({ url: '/pages/membership/index' })
  },

  onMenuTap(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key || '')
    switch (key) {
      case 'membership':
        wx.navigateTo({ url: '/pages/membership/index' })
        break
      case 'settings':
        wx.navigateTo({ url: '/pages/settings/index' })
        break
      case 'explore':
        wx.navigateTo({ url: '/pages/guide/index' })
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

})
