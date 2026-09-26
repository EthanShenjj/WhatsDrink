import type { GrowthColorId, GrowthSnapshot, UserProfile } from '../../domain/types'
import {
  ensureProfile,
  listFootprints,
  saveGrowthPreferences,
  startGrowthTrial,
} from '../../services/repository'
import { computeGrowthSnapshot } from '../../utils/growth'

interface PageData {
  profile: UserProfile | null
  snapshot: GrowthSnapshot | null
  loading: boolean
  saving: boolean
  progressPercent: number
  iconColorId: GrowthColorId
  reportVisible: boolean
  unlockedColorCount: number
}

const app = getApp<IAppOption>()

Page<PageData, WechatMiniprogram.IAnyObject>({
  data: {
    profile: null,
    snapshot: null,
    loading: true,
    saving: false,
    progressPercent: 0,
    iconColorId: 'journey',
    reportVisible: false,
    unlockedColorCount: 0,
  },

  onShow() {
    this.loadGrowth()
  },

  async loadGrowth() {
    this.setData({ loading: true })
    try {
      const [profile, footprints] = await Promise.all([ensureProfile(), listFootprints()])
      const snapshot = computeGrowthSnapshot(footprints, profile)
      app.globalData.profile = profile
      this.setData({
        profile,
        snapshot,
        loading: false,
        progressPercent: Math.min(100, Math.round(snapshot.nextGoalProgress / snapshot.nextGoalTarget * 100)),
        iconColorId: profile.growth?.iconColorId || snapshot.activeColorId,
        unlockedColorCount: snapshot.colors.filter((item) => item.unlocked).length,
      })
    } catch (error) {
      console.warn('[growth] load failed', error)
      this.setData({ loading: false })
      wx.showToast({ title: '成长状态加载失败', icon: 'none' })
    }
  },

  async onColorTap(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '') as GrowthColorId
    const color = this.data.snapshot?.colors.find((item) => item.id === id)
    if (!color?.unlocked) {
      wx.showToast({ title: color?.hidden ? '继续记录，等待一次特别相遇' : color?.description || '尚未解锁', icon: 'none' })
      return
    }
    if (!this.data.snapshot?.isPlus) {
      await this.offerTrial('拾光+ 可以自由切换并锁定所有已解锁颜色。')
      return
    }
    const next = this.data.profile?.growth?.lockedColorId === id ? undefined : id
    await this.persistPreferences({ lockedColorId: next })
    wx.showToast({ title: next ? '已锁定这个颜色' : '已跟随每周状态', icon: 'none' })
  },

  async onIconTap(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '') as GrowthColorId
    const color = this.data.snapshot?.colors.find((item) => item.id === id)
    if (!color?.unlocked) {
      wx.showToast({ title: '先完成成长条件再使用', icon: 'none' })
      return
    }
    if (!this.data.snapshot?.isPlus) {
      await this.offerTrial('拾光+ 可以让小拾头像与分享卡同步你的专属颜色。')
      return
    }
    await this.persistPreferences({ iconColorId: id })
    this.setData({ iconColorId: id })
    wx.showToast({ title: '图标主题已同步', icon: 'success' })
  },

  async onMonthlyReport() {
    const snapshot = this.data.snapshot
    if (!snapshot) return
    const viewed = this.data.profile?.growth?.viewedMonthlyReports || []
    if (!viewed.includes(snapshot.monthKey)) {
      await this.persistPreferences({ viewedMonthlyReports: [...viewed, snapshot.monthKey] })
    }
    this.setData({ reportVisible: true })
  },

  onReportClose() {
    this.setData({ reportVisible: false })
  },

  onReportShare() {
    const monthKey = this.data.snapshot?.monthKey
    if (!monthKey) return
    this.setData({ reportVisible: false })
    wx.navigateTo({ url: `/pages/share-card/index?type=map&month=${monthKey}` })
  },

  noop() {
    // Keep taps inside the report panel from closing the mask.
  },

  async onStartTrial() {
    await this.activateTrial()
  },

  onMembershipTap() {
    wx.navigateTo({ url: '/pages/membership/index' })
  },

  async offerTrial(content: string) {
    const confirmed = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: '让小拾更像你',
        content,
        confirmText: '体验 7 天',
        cancelText: '继续成长',
        success: (result) => resolve(Boolean(result.confirm)),
        fail: () => resolve(false),
      })
    })
    if (confirmed) await this.activateTrial()
  },

  async activateTrial() {
    if (this.data.profile?.growth?.trialStartedAt && !this.data.snapshot?.isPlus) {
      wx.navigateTo({ url: '/pages/membership/index' })
      return
    }
    if (this.data.snapshot?.isPlus) {
      wx.showToast({ title: '拾光+ 体验中', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      const profile = await startGrowthTrial()
      this.setData({ profile, saving: false })
      await this.loadGrowth()
      wx.showToast({ title: '已开启 7 天体验', icon: 'success' })
    } catch (error) {
      console.warn('[growth] trial failed', error)
      this.setData({ saving: false })
      wx.showToast({ title: '开启失败，请重试', icon: 'none' })
    }
  },

  async persistPreferences(patch: Parameters<typeof saveGrowthPreferences>[0]) {
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      const profile = await saveGrowthPreferences(patch)
      const footprints = await listFootprints()
      const snapshot = computeGrowthSnapshot(footprints, profile)
      app.globalData.profile = profile
      this.setData({
        profile,
        snapshot,
        saving: false,
        unlockedColorCount: snapshot.colors.filter((item) => item.unlocked).length,
      })
    } catch (error) {
      console.warn('[growth] save preference failed', error)
      this.setData({ saving: false })
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    }
  },
})
