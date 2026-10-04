import type { UserProfile } from '../../domain/types'
import { clearAllData, ensureProfile } from '../../services/repository'
import { buildDataExport } from '../../services/export'

interface PageData {
  profile: UserProfile | null
  isLoggedIn: boolean
  loginSheetVisible: boolean
  clearing: boolean
  exporting: boolean
}

const app = getApp<IAppOption>()

Page<PageData, WechatMiniprogram.IAnyObject>({
  data: {
    profile: null,
    isLoggedIn: false,
    loginSheetVisible: false,
    clearing: false,
    exporting: false,
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

  async onExport() {
    if (this.data.exporting || this.data.clearing) return
    if (typeof wx.shareFileMessage !== 'function') {
      wx.showToast({ title: '请更新微信后使用文件导出', icon: 'none' })
      return
    }
    this.setData({ exporting: true })
    wx.showLoading({ title: '整理记录中…', mask: true })
    try {
      const data = await buildDataExport()
      const fileName = `拾光迹-${Date.now()}.json`
      const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`
      await new Promise<void>((resolve, reject) => wx.getFileSystemManager().writeFile({ filePath, data, encoding: 'utf8', success: () => resolve(), fail: reject }))
      const cleanup = () => wx.getFileSystemManager().unlink({ filePath, fail: () => undefined })
      wx.hideLoading()
      wx.showModal({
        title: '导出文件已生成',
        content: '包含足迹、计划与胶囊信息。照片仅保留文件引用；未解锁胶囊不导出内容。文件含个人数据，请选择可信的保存位置。',
        confirmText: '保存文件', cancelText: '暂不保存',
        success: ({ confirm }) => {
          if (confirm) wx.shareFileMessage({ filePath, fileName, complete: cleanup, fail: (error) => {
            if (!error.errMsg.includes('cancel')) wx.showToast({ title: '文件发送失败，请重新导出', icon: 'none' })
          } })
          else cleanup()
        },
        fail: cleanup,
      })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '导出失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ exporting: false })
    }
  },

  onPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' })
  },

  async onClearAll() {
    if (this.data.clearing || this.data.exporting) return
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
