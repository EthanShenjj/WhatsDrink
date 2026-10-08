import type { Footprint, GrowthOverview, LightingStats, MembershipLevelView, UserProfile } from '../../domain/types'
import {
  ensureProfile,
  getFootprintSnapshot,
  listFootprints,
} from '../../services/repository'
import { APP_VERSION } from '../../services/config'
import { computeLighting } from '../../utils/footprint'
import { computeGrowthOverview } from '../../utils/growth'
import { getMembershipLevelView } from '../../utils/payment'
import { installUpdatePerformanceLogger, recordInteraction, startPerformanceSpan } from '../../utils/performance'

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
  growth: GrowthOverview | null
  membershipLevel: MembershipLevelView
  avatarLoadFailed: boolean
  menu: MenuRow[]
  version: string
  loading: boolean
}

const app = getApp<IAppOption>()

const MENU: MenuRow[] = [
  { key: 'settings', label: '地图设置', icon: 'settings' },
  { key: 'explore', label: '想去与计划', icon: 'compass' },
  { key: 'about', label: '关于拾光迹', icon: 'info' },
]

Page<PageData, WechatMiniprogram.IAnyObject>({
  isVisible: false,
  loadSequence: 0,
  lastFootprints: null as Footprint[] | null,
  lastProfile: null as UserProfile | null,
  data: {
    profile: null,
    isLoggedIn: false,
    stats: null,
    growth: null,
    membershipLevel: getMembershipLevelView(),
    avatarLoadFailed: false,
    menu: MENU,
    version: APP_VERSION,
    loading: true,
  },

  onLoad() {
    installUpdatePerformanceLogger(this, 'mine')
  },

  onShow() {
    this.isVisible = true
    const tabBar = this.getTabBar?.()
    if (tabBar && (tabBar.data as { selected?: number }).selected !== 3) tabBar.setData({ selected: 3 })
    const cached = getFootprintSnapshot()
    if (cached && app.globalData.profile) this.applyProfileAndStats(app.globalData.profile, cached)
    this.loadProfileAndStats()
  },

  onHide() {
    this.isVisible = false
  },

  async loadProfileAndStats() {
    const sequence = ++this.loadSequence
    if (!this.data.profile) this.setData({ loading: true })
    try {
      const profile = await ensureProfile()
      app.globalData.profile = profile
      const isLoggedIn = Boolean(profile && profile.nickname && profile.avatarUrl)
      // 复用 repository 共享缓存：60 秒内切页不重复发起全量请求
      let list: Footprint[]
      try {
        list = await listFootprints({ maxAgeMs: 60_000 })
      } catch (err) {
        console.warn('[mine] load footprints failed', err)
        list = app.globalData.footprints || []
      }
      if (sequence !== this.loadSequence || !this.isVisible) return
      this.applyProfileAndStats(profile, list)
    } catch (err) {
      console.warn('[mine] load failed', err)
      this.setData({ loading: false })
    }
  },

  applyProfileAndStats(profile: UserProfile, list: Footprint[]) {
    if (list === this.lastFootprints && profile === this.lastProfile) return
    const end = startPerformanceSpan('mine.applyProfileAndStats')
    this.lastFootprints = list
    this.lastProfile = profile
    const isLoggedIn = Boolean(profile.nickname && profile.avatarUrl)
    const stats = computeLighting(list)
    const growth = computeGrowthOverview(list, profile)
    const membershipLevel = getMembershipLevelView(profile.growth)
    const avatarChanged = profile.avatarUrl !== this.data.profile?.avatarUrl
    this.setData({
      profile,
      isLoggedIn,
      stats,
      growth,
      membershipLevel,
      loading: false,
      ...(avatarChanged ? { avatarLoadFailed: false } : {}),
    }, () => end({ records: list.length }))
  },

  onAvatarError() {
    this.setData({ avatarLoadFailed: true })
  },

  onProfileTap() {
    wx.navigateTo({ url: '/pages/personal-settings/index' })
  },

  onGrowthTap() {
    wx.navigateTo({ url: '/pages/growth/index' })
  },

  onMembershipTap() {
    wx.navigateTo({ url: '/pages/membership/index' })
  },

  onMenuTap(e: WechatMiniprogram.TouchEvent) {
    recordInteraction('mine.menu')
    const key = String(e.currentTarget.dataset.key || '')
    switch (key) {
      case 'settings':
        wx.navigateTo({ url: '/pages/settings/index' })
        break
      case 'explore':
        wx.navigateTo({ url: '/pages/guide/index' })
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
