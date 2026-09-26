import type { UserProfile } from '../../domain/types'
import { clearAllData, ensureProfile } from '../../services/repository'

interface PageData {
  profile: UserProfile | null
  isLoggedIn: boolean
  loginSheetVisible: boolean
  clearing: boolean
}

const app = getApp<IAppOption>()

Page<PageData, WechatMiniprogram.IAnyObject>({
  data: {
    profile: null,
    isLoggedIn: false,
    loginSheetVisible: false,
    clearing: false,
  },

  async onShow() {
    try {
      const profile = await ensureProfile()
      app.globalData.profile = profile
      this.setData({
        profile,
        isLoggedIn: Boolean(profile.nickname && profile.avatarUrl),
      })
    } catch (err) {
      console.warn('[personal-settings] load profile failed', err)
    }
  },

  onProfileTap() {
    if (this.data.isLoggedIn) {
      wx.navigateTo({ url: '/pages/mine-edit/index' })
      return
    }
    this.setData({ loginSheetVisible: true })
  },

  onLoginSuccess(e: WechatMiniprogram.CustomEvent<{ profile: UserProfile }>) {
    const profile = e.detail.profile
    app.globalData.profile = profile
    this.setData({ profile, isLoggedIn: true, loginSheetVisible: false })
    wx.showToast({ title: '资料已完善', icon: 'success' })
  },

  onLoginCancel() {
    this.setData({ loginSheetVisible: false })
  },

  onExport() {
    wx.showToast({ title: '数据导出功能开发中', icon: 'none' })
  },

  onPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' })
  },

  async onClearAll() {
    if (this.data.clearing) return
    const confirmed = await this.confirmClear()
    if (!confirmed) return

    this.setData({ clearing: true })
    try {
      await clearAllData()
      app.globalData.footprints = []
      app.globalData.footprintsCachedAt = Date.now()
      wx.showToast({ title: '已清除所有记录', icon: 'success' })
    } catch (err) {
      console.warn('[personal-settings] clear failed', err)
      wx.showToast({ title: '操作失败，请重试', icon: 'none' })
    } finally {
      this.setData({ clearing: false })
    }
  },

  confirmClear(): Promise<boolean> {
    return new Promise((resolve) => {
      wx.showModal({
        title: '清除所有记录',
        content: '将删除所有足迹、照片、计划与胶囊，且无法恢复。确定继续吗？',
        confirmText: '确认清除',
        confirmColor: '#C74E63',
        cancelText: '取消',
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false),
      })
    })
  },
})
