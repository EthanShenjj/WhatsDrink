import type { Footprint } from '../../domain/types'
import { listFootprints, deleteFootprint, saveFootprint } from '../../services/repository'
import { placeKey, visitsAtPlace } from '../../utils/footprint'
import { formatVisitDate } from '../../utils/date'
import {
  moodLabel,
  moodEmoji,
  categoryLabel,
  categoryEmoji,
} from '../../data/options'

interface PageData {
  id: string
  loading: boolean
  footprint?: Footprint
  photoIndex: number
  relatedVisits: Footprint[]
  visitIndex: number
  totalVisits: number
  moodLabel: string
  moodEmoji: string
  categoryLabel: string
  categoryEmoji: string
  formattedDate: string
  locationText: string
  hasPhoto: boolean
  isWishlist: boolean
  isFulfilled: boolean
  isVisit: boolean
  firstVisit?: Footprint
  latestVisit?: Footprint
  comparisonOpen: boolean
}

Page<PageData, WechatMiniprogram.IAnyObject>({
  data: {
    id: '',
    loading: true,
    footprint: undefined,
    photoIndex: 0,
    relatedVisits: [],
    visitIndex: 0,
    totalVisits: 1,
    moodLabel: '',
    moodEmoji: '',
    categoryLabel: '',
    categoryEmoji: '',
    formattedDate: '',
    locationText: '',
    hasPhoto: false,
    isWishlist: false,
    isFulfilled: false,
    isVisit: false,
    firstVisit: undefined,
    latestVisit: undefined,
    comparisonOpen: false,
  },

  onLoad(query: Record<string, string>) {
    if (!query.id) {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 600)
      return
    }
    this.setData({ id: query.id })
  },

  onShow() {
    if (this.data.id) this.loadFootprint(this.data.id)
  },

  onPullDownRefresh() {
    if (this.data.id) {
      this.loadFootprint(this.data.id).finally(() => wx.stopPullDownRefresh())
    } else {
      wx.stopPullDownRefresh()
    }
  },

  async loadFootprint(id: string) {
    this.setData({ loading: true })
    try {
      const all = await listFootprints()
      const fp = all.find((f) => f.id === id)
      if (!fp) {
        wx.showToast({ title: '足迹不存在或已删除', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 600)
        return
      }
      const related = visitsAtPlace(all, fp)
      const visitIndex = Math.max(
        0,
        related.findIndex((f) => f.id === id),
      )
      const locationParts = [fp.province, fp.city, fp.district].filter(Boolean) as string[]
      this.setData({
        footprint: fp,
        loading: false,
        relatedVisits: related,
        visitIndex,
        totalVisits: related.length,
        firstVisit: related[related.length - 1],
        latestVisit: related[0],
        moodLabel: moodLabel(fp.mood),
        moodEmoji: moodEmoji(fp.mood),
        categoryLabel: categoryLabel(fp.category),
        categoryEmoji: categoryEmoji(fp.category),
        formattedDate: formatVisitDate(fp.visitDate),
        locationText: locationParts.join(' · '),
        hasPhoto: fp.photos.length > 0,
        isWishlist: fp.status === 'wishlist',
        isFulfilled: fp.status === 'fulfilled',
        isVisit: fp.status === 'visited',
        photoIndex: 0,
      })
      wx.setNavigationBarTitle({
        title: fp.status === 'wishlist' ? '想去详情' : fp.status === 'fulfilled' ? '已实现的愿望' : '地点年轮',
      })
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onPhotoSwiperChange(e: WechatMiniprogram.SwiperChange) {
    this.setData({ photoIndex: e.detail.current })
  },

  selectVisit(
    e: WechatMiniprogram.TouchEvent & { currentTarget: { dataset: { id: string } } },
  ) {
    const targetId = e.currentTarget.dataset.id
    if (!targetId || targetId === this.data.id) return
    wx.redirectTo({ url: `/pages/footprint-detail/index?id=${targetId}` })
  },

  onViewInMap() {
    wx.switchTab({
      url: '/pages/map/index',
    })
  },

  onEdit() {
    if (!this.data.footprint) return
    wx.navigateTo({ url: `/pages/footprint-form/index?id=${this.data.footprint.id}` })
  },

  onConvertWishlist() {
    if (!this.data.footprint || this.data.footprint.status !== 'wishlist') return
    wx.navigateTo({
      url: `/pages/footprint-form/index?id=${this.data.footprint.id}&convert=1`,
    })
  },

  onAddAnotherVisit() {
    if (!this.data.footprint) return
    wx.navigateTo({ url: `/pages/footprint-form/index?revisit=${this.data.footprint.id}` })
  },

  onToggleComparison() {
    this.setData({ comparisonOpen: !this.data.comparisonOpen })
  },

  async onMarkImportant() {
    const fp = this.data.footprint
    if (!fp || fp.status !== 'visited') return
    try {
      await saveFootprint({ ...fp, isImportant: !fp.isImportant })
      await this.loadFootprint(fp.id)
      wx.showToast({ title: fp.isImportant ? '已取消重要标记' : '已标记重要', icon: 'none' })
    } catch {
      wx.showToast({ title: '标记失败', icon: 'none' })
    }
  },

  async onAddWishlistAgain() {
    const fp = this.data.footprint
    if (!fp || fp.status !== 'visited') return
    try {
      const all = await listFootprints()
      if (all.some((item) => item.status === 'wishlist' && placeKey(item) === placeKey(fp))) {
        wx.showToast({ title: '这个地点已在想去清单', icon: 'none' })
        return
      }
      await saveFootprint({
        ...fp,
        id: undefined,
        status: 'wishlist',
        visitDate: undefined,
        photos: [],
        mood: undefined,
        note: undefined,
        isImportant: false,
        wishId: undefined,
        wishlistCreatedAt: Date.now(),
        convertedFromWishlist: false,
      })
      wx.showToast({ title: '已加入想再去', icon: 'none' })
    } catch {
      wx.showToast({ title: '添加失败', icon: 'none' })
    }
  },

  onCreateCapsule() {
    if (!this.data.footprint) return
    wx.navigateTo({ url: `/pages/time-capsule/index?footprintId=${this.data.footprint.id}` })
  },

  onShare() {
    if (!this.data.footprint) return
    wx.navigateTo({
      url: `/pages/share-card/index?footprintId=${this.data.footprint.id}`,
    })
  },

  onDelete() {
    if (!this.data.footprint) return
    wx.showModal({
      title: '删除足迹',
      content: '删除后无法恢复，确认删除？',
      confirmColor: '#C0524A',
      confirmText: '删除',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中…', mask: true })
        try {
          await deleteFootprint(this.data.footprint!.id)
          wx.hideLoading()
          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 500)
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      },
    })
  },

  previewPhoto(
    e: WechatMiniprogram.TouchEvent & { currentTarget: { dataset: { url: string } } },
  ) {
    if (!this.data.footprint) return
    wx.previewImage({
      urls: this.data.footprint.photos,
      current: e.currentTarget.dataset.url || this.data.footprint.photos[0],
    })
  },
})
