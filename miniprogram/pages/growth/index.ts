import type { GrowthColorId, GrowthSnapshot, UserProfile } from '../../domain/types'
import {
  ensureProfile,
  listFootprints,
  saveGrowthPreferences,
  startGrowthTrial,
} from '../../services/repository'
import { computeGrowthSnapshot, hasDistantPairDeferred } from '../../utils/growth'
import { installUpdatePerformanceLogger, recordInteraction } from '../../utils/performance'

interface PageData {
  profile: UserProfile | null
  snapshot: GrowthSnapshot | null
  loading: boolean
  saving: boolean
  progressPercent: number
  iconColorId: GrowthColorId
  reportVisible: boolean
  heavySectionsReady: boolean
}

const app = getApp<IAppOption>()

Page<PageData, WechatMiniprogram.IAnyObject>({
  isVisible: false,
  loadSequence: 0,
  heavyObserver: null as WechatMiniprogram.IntersectionObserver | null,
  data: {
    profile: null,
    snapshot: null,
    loading: true,
    saving: false,
    progressPercent: 0,
    iconColorId: 'journey',
    reportVisible: false,
    heavySectionsReady: false,
  },

  onLoad() {
    installUpdatePerformanceLogger(this, 'growth')
  },

  onShow() {
    this.isVisible = true
    this.loadGrowth()
  },

  onHide() {
    this.isVisible = false
    this.disconnectHeavyObserver()
  },

  onUnload() {
    this.disconnectHeavyObserver()
  },

  onPageScroll(event: WechatMiniprogram.Page.IPageScrollOption) {
    if (!this.data.heavySectionsReady && event.scrollTop > 520) {
      this.revealHeavySections()
    }
  },

  async loadGrowth() {
    const sequence = ++this.loadSequence
    this.setData({ loading: true })
    try {
      const [profile, footprints] = await Promise.all([
        ensureProfile(),
        listFootprints({ maxAgeMs: 60_000 }),
      ])
      const snapshot = computeGrowthSnapshot(footprints, profile, undefined, { skipDistance: true })
      if (sequence !== this.loadSequence || !this.isVisible) return
      app.globalData.profile = profile
      this.setData({
        profile,
        snapshot,
        loading: false,
        progressPercent: Math.min(100, Math.round(snapshot.nextGoalProgress / snapshot.nextGoalTarget * 100)),
        iconColorId: profile.growth?.iconColorId || snapshot.activeColorId,
      }, () => this.observeHeavySections())
      const hasDistantPair = await hasDistantPairDeferred(footprints)
      if (sequence !== this.loadSequence || !this.isVisible) return
      const current = this.data.snapshot
      if (current) {
        this.setData({
          'snapshot.hiddenStates': current.hiddenStates.map((item) =>
            item.id === 'distance' ? { ...item, unlocked: hasDistantPair } : item),
        })
      }
    } catch (error) {
      console.warn('[growth] load failed', error)
      this.setData({ loading: false })
      wx.showToast({ title: '成长状态加载失败', icon: 'none' })
    }
  },

  async onColorTap(event: WechatMiniprogram.TouchEvent) {
    recordInteraction('growth.color')
    const id = String(event.currentTarget.dataset.id || '') as GrowthColorId
    const color = this.data.snapshot?.colors.find((item) => item.id === id)
    if (!color?.unlocked) {
      wx.showToast({ title: color?.hidden ? '继续记录，等待一次特别相遇' : color?.description || '尚未解锁', icon: 'none' })
      return
    }
    if (this.data.snapshot?.colorMode === 'fixed' && this.data.snapshot.activeColorId === id) return
    if (await this.persistPreferences({ lockedColorId: id })) {
      wx.showToast({ title: '已固定展示这个颜色', icon: 'none' })
    }
  },

  async onAutoColorTap() {
    recordInteraction('growth.color.auto')
    if (this.data.snapshot?.colorMode === 'auto') return
    if (await this.persistPreferences({ lockedColorId: null })) {
      wx.showToast({ title: '已开启自动调整', icon: 'none' })
    }
  },

  async onIconTap(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '') as GrowthColorId
    const color = this.data.snapshot?.colors.find((item) => item.id === id)
    if (!color?.unlocked) {
      wx.showToast({ title: '先完成成长条件再使用', icon: 'none' })
      return
    }
    if (!this.data.snapshot?.isPlus) {
      await this.offerTrial('会员可以让 Lumi 使用你的专属颜色。')
      return
    }
    if (await this.persistPreferences({ iconColorId: id })) {
      this.setData({ iconColorId: id })
      wx.showToast({ title: '图标主题已同步', icon: 'success' })
    }
  },

  async onMonthlyReport() {
    recordInteraction('growth.report')
    const snapshot = this.data.snapshot
    if (!snapshot) return
    const viewed = this.data.profile?.growth?.viewedMonthlyReports || []
    this.setData({ reportVisible: true })
    if (!viewed.includes(snapshot.monthKey)) {
      this.persistPreferences({ viewedMonthlyReports: [...viewed, snapshot.monthKey] })
        .catch(() => undefined)
    }
  },

  onReportClose() {
    this.setData({ reportVisible: false })
  },

  noop() {
    // Keep taps inside the report panel from closing the mask.
  },

  observeHeavySections() {
    if (this.data.heavySectionsReady || this.heavyObserver || !this.isVisible) return
    wx.nextTick(() => {
      if (this.data.heavySectionsReady || this.heavyObserver || !this.isVisible) return
      const observer = this.createIntersectionObserver({ thresholds: [0, 0.01], nativeMode: true })
      this.heavyObserver = observer
      observer
        .relativeToViewport({ bottom: 320 })
        .observe('#growth-heavy-anchor', (result) => {
          if (result.intersectionRatio > 0) this.revealHeavySections()
        })
    })
  },

  revealHeavySections() {
    if (this.data.heavySectionsReady) return
    this.disconnectHeavyObserver()
    this.setData({ heavySectionsReady: true })
  },

  disconnectHeavyObserver() {
    this.heavyObserver?.disconnect()
    this.heavyObserver = null
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
        title: '让 Lumi 更像你',
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
    if (this.data.saving) return
    if (this.data.profile?.growth?.trialStartedAt && !this.data.snapshot?.isPlus) {
      wx.navigateTo({ url: '/pages/membership/index' })
      return
    }
    if (this.data.snapshot?.isPlus) {
      wx.showToast({ title: '会员体验中', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      const profile = await startGrowthTrial()
      this.setData({ profile })
      await this.loadGrowth()
      wx.showToast({ title: '已开启 7 天体验', icon: 'success' })
    } catch (error) {
      console.warn('[growth] trial failed', error)
      wx.showToast({ title: '开启失败，请重试', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  async persistPreferences(patch: Parameters<typeof saveGrowthPreferences>[0]): Promise<boolean> {
    if (this.data.saving) return false
    this.setData({ saving: true })
    try {
      const profile = await saveGrowthPreferences(patch)
      const footprints = await listFootprints({ maxAgeMs: 60_000 })
      const snapshot = computeGrowthSnapshot(footprints, profile, undefined, { skipDistance: true })
      const distanceUnlocked = this.data.snapshot?.hiddenStates
        .find((item) => item.id === 'distance')?.unlocked || false
      snapshot.hiddenStates = snapshot.hiddenStates.map((item) =>
        item.id === 'distance' ? { ...item, unlocked: distanceUnlocked } : item)
      app.globalData.profile = profile
      this.setData({
        profile,
        snapshot,
        saving: false,
        iconColorId: profile.growth?.iconColorId || snapshot.activeColorId,
      })
      return true
    } catch (error) {
      console.warn('[growth] save preference failed', error)
      this.setData({ saving: false })
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      return false
    }
  },
})
