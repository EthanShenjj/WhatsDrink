import type { Footprint } from '../../domain/types'
import { getFootprint, getFootprintSnapshot, listFootprints, deleteFootprint, saveFootprint } from '../../services/repository'
import { placeKey, visitsAtPlace } from '../../utils/footprint'
import { formatVisitDate } from '../../utils/date'
import {
  moodLabel,
  moodEmoji,
  categoryLabel,
  categoryEmoji,
} from '../../data/options'
import { installUpdatePerformanceLogger, recordInteraction } from '../../utils/performance'
import { trackProductEvent } from '../../services/product-events'

interface TicketVisit extends Footprint {
  ticketNumber: number
  ticketNumberLabel: string
  ticketCode: string
  displayDate: string
  ticketDate: string
  ticketYear: string
  ticketLocation: string
  ticketColor: string
  isCurrent: boolean
  hasPhoto: boolean
  previewPhoto: string
}

const ticketDateParts = (visit: Footprint): { date: string; year: string } => {
  const rawDate = visit.visitDate || new Date(visit.createdAt).toISOString()
  const date = new Date(rawDate)
  if (Number.isNaN(date.getTime())) return { date: '--.--', year: 'MEMORY' }
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return { date: `${month}.${day}`, year: String(date.getFullYear()) }
}

const ticketCode = (visit: Footprint, ticketNumber: number): string => {
  const compactId = visit.id.replace(/[^a-z0-9]/gi, '').toUpperCase()
  const suffix = compactId.slice(-5).padStart(5, '0')
  return `SGJ-${String(ticketNumber).padStart(2, '0')}-${suffix}`
}

interface PageData {
  id: string
  loading: boolean
  footprint?: Footprint
  photoIndex: number
  relatedVisits: Footprint[]
  ticketVisits: TicketVisit[]
  visibleTicketVisits: TicketVisit[]
  ticketsExpanded: boolean
  canExpandTickets: boolean
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
  lastSnapshot: null as Footprint[] | null,
  data: {
    id: '',
    loading: true,
    footprint: undefined,
    photoIndex: 0,
    relatedVisits: [],
    ticketVisits: [],
    visibleTicketVisits: [],
    ticketsExpanded: false,
    canExpandTickets: false,
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
    installUpdatePerformanceLogger(this, 'footprint-detail')
    if (!query.id) {
      wx.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 600)
      return
    }
    this.setData({ id: query.id })
    trackProductEvent('old_record_opened')
  },

  onShow() {
    if (this.data.id) this.loadFootprint(this.data.id)
  },

  onPullDownRefresh() {
    if (this.data.id) {
      this.loadFootprint(this.data.id, true).finally(() => wx.stopPullDownRefresh())
    } else {
      wx.stopPullDownRefresh()
    }
  },

  async loadFootprint(id: string, force = false) {
    if (!this.data.footprint) this.setData({ loading: true })
    try {
      const [all, fullFootprint] = await Promise.all([
        force
          ? listFootprints()
          : Promise.resolve(getFootprintSnapshot() || listFootprints({ maxAgeMs: 60_000 })),
        getFootprint(id, { force }),
      ])
      if (!force && all === this.lastSnapshot && this.data.footprint?.id === id) return
      this.lastSnapshot = all
      const fp = fullFootprint || all.find((f) => f.id === id)
      if (!fp) {
        this.setData({ footprint: undefined, loading: false })
        return
      }
      const related = visitsAtPlace(all.map((item) => item.id === fp.id ? fp : item), fp)
      const visitIndex = Math.max(
        0,
        related.findIndex((f) => f.id === id),
      )
      const ticketVisits = related.map((visit, index) => {
        const ticketNumber = related.length - index
        const dateParts = ticketDateParts(visit)
        return {
          ...visit,
          ticketNumber,
          ticketNumberLabel: String(ticketNumber).padStart(2, '0'),
          ticketCode: ticketCode(visit, ticketNumber),
          displayDate: formatVisitDate(visit.visitDate),
          ticketDate: dateParts.date,
          ticketYear: dateParts.year,
          ticketLocation: visit.district || visit.city || visit.province || visit.address || '未标注地点',
          ticketColor: visit.markerStyle?.color || '#5B6CFF',
          isCurrent: visit.id === id,
          hasPhoto: (visit.photoCount ?? visit.photos.length) > 0,
          previewPhoto: visit.photoThumbs?.[0] || visit.photos[0] || '',
        }
      })
      const ticketsExpanded = related.length > 3 && visitIndex >= 3
      const locationParts = [fp.province, fp.city, fp.district].filter(Boolean) as string[]
      this.setData({
        footprint: fp,
        loading: false,
        relatedVisits: related,
        ticketVisits,
        visibleTicketVisits: ticketsExpanded ? ticketVisits : ticketVisits.slice(0, 3),
        ticketsExpanded,
        canExpandTickets: ticketVisits.length > 3,
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
        hasPhoto: (fp.photoCount ?? fp.photos.length) > 0,
        isWishlist: fp.status === 'wishlist',
        isFulfilled: fp.status === 'fulfilled',
        isVisit: fp.status === 'visited',
        photoIndex: 0,
      })
      wx.setNavigationBarTitle({
        title: fp.status === 'wishlist' ? '想去详情' : fp.status === 'fulfilled' ? '已实现的愿望' : '回忆票根',
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
    const footprint = this.data.footprint
    if (!footprint) return
    if (typeof footprint.lat !== 'number' || typeof footprint.lng !== 'number') {
      wx.showToast({ title: '请先编辑补充地图位置', icon: 'none' })
      return
    }
    wx.setStorageSync('sgj:map-target', footprint)
    wx.switchTab({
      url: '/pages/map/index',
    })
  },

  onEmptyReturn() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/map/index' }) })
  },

  onShareAppMessage() {
    const footprint = this.data.footprint
    if (!footprint) return { title: '拾光迹 · 私人记忆地图', path: '/pages/map/index' }
    // 票根只带用户主动选择公开的地点与日期，不包含照片、短记或坐标。
    const ticket = encodeURIComponent(JSON.stringify({
      name: footprint.poiName.slice(0, 40),
      date: footprint.visitDate || '',
      location: (footprint.city || footprint.province || '').slice(0, 30),
      code: this.data.ticketVisits.find((item) => item.id === footprint.id)?.ticketCode || ticketCode(footprint, 1),
    }))
    return {
      title: `${footprint.poiName} · 我的回忆票根`,
      path: `/pages/ticket-share/index?ticket=${ticket}`,
    }
  },

  onEdit() {
    if (!this.data.footprint) return
    wx.navigateTo({ url: `/pages/footprint-form/index?id=${this.data.footprint.id}` })
  },

  onPhotoEdit() {
    recordInteraction('detail.photo-edit')
    this.onEdit()
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
    recordInteraction('detail.comparison')
    this.setData({ comparisonOpen: !this.data.comparisonOpen })
  },

  onToggleTickets() {
    const ticketsExpanded = !this.data.ticketsExpanded
    this.setData({
      ticketsExpanded,
      visibleTicketVisits: ticketsExpanded
        ? this.data.ticketVisits
        : this.data.ticketVisits.slice(0, 3),
    })
  },

  async onMarkImportant() {
    if (this.markingImportant) return
    recordInteraction('detail.important')
    const fp = this.data.footprint
    if (!fp || fp.status !== 'visited') return
    this.markingImportant = true
    try {
      const saved = await saveFootprint({ ...fp, isImportant: !fp.isImportant })
      const updateTicket = (item: TicketVisit): TicketVisit =>
        item.id === saved.id ? { ...item, ...saved, hasPhoto: saved.photos.length > 0 } : item
      this.setData({
        footprint: saved,
        relatedVisits: this.data.relatedVisits.map((item) => item.id === saved.id ? saved : item),
        ticketVisits: this.data.ticketVisits.map(updateTicket),
        visibleTicketVisits: this.data.visibleTicketVisits.map(updateTicket),
        firstVisit: this.data.firstVisit?.id === saved.id ? saved : this.data.firstVisit,
        latestVisit: this.data.latestVisit?.id === saved.id ? saved : this.data.latestVisit,
      })
      wx.showToast({ title: fp.isImportant ? '已取消重要标记' : '已标记重要', icon: 'none' })
    } catch {
      wx.showToast({ title: '标记失败', icon: 'none' })
    } finally {
      this.markingImportant = false
    }
  },

  async onAddWishlistAgain() {
    const fp = this.data.footprint
    if (!fp || fp.status !== 'visited') return
    try {
      const all = getFootprintSnapshot() || await listFootprints({ maxAgeMs: 60_000 })
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

})
