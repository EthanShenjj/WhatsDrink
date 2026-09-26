import type { FootprintDraft, FootprintStatus } from '../../domain/types'
import {
  saveFootprint,
  fulfillWishlistFootprint,
  listFootprints,
  deleteFootprint,
  getFootprint,
  uploadPhoto,
  deletePhotos,
  saveDraft,
  loadDraft,
  clearDraft,
} from '../../services/repository'
import { createDefaultFootprint } from '../../utils/footprint'
import { placeKey, visitsAtPlace } from '../../utils/footprint'
import { todayKey } from '../../utils/date'
import {
  CATEGORY_OPTIONS,
  MARKER_COLORS,
  MARKER_EMOJIS,
} from '../../data/options'

interface PageData {
  id?: string
  placeId?: string
  status: FootprintStatus
  poiName: string
  address: string
  lat?: number
  lng?: number
  country: string
  province: string
  city: string
  district: string
  visitDate?: string
  photos: string[]
  originalPhotos: string[]
  mood?: string
  category?: string
  tags: string[]
  note?: string
  markerColor: string
  markerEmoji: string
  source: 'manual' | 'ai' | 'import'
  wishlistCreatedAt?: number
  convertedFromWishlist: boolean
  wishId?: string
  fulfilledAt?: number
  fulfilledVisitId?: string
  isImportant: boolean
  fulfillingWish: boolean
  inputValue: string
  loading: boolean
  saving: boolean
  optionalOpen: boolean
  categoryOptions: typeof CATEGORY_OPTIONS
  markerColors: typeof MARKER_COLORS
  markerEmojis: typeof MARKER_EMOJIS
  isEditing: boolean
  saved: boolean
  successVisible: boolean
  successTitle: string
  successDescription: string
  successState: 'journey' | 'highlight' | 'companion'
}

Page<PageData, WechatMiniprogram.IAnyObject>({
  data: {
    id: undefined,
    placeId: undefined,
    status: 'visited',
    poiName: '',
    address: '',
    lat: undefined,
    lng: undefined,
    country: '',
    province: '',
    city: '',
    district: '',
    visitDate: todayKey(),
    photos: [],
    originalPhotos: [],
    mood: '',
    category: '',
    tags: [],
    note: '',
    markerColor: MARKER_COLORS[0].value,
    markerEmoji: '',
    source: 'manual',
    wishlistCreatedAt: undefined,
    convertedFromWishlist: false,
    wishId: undefined,
    fulfilledAt: undefined,
    fulfilledVisitId: undefined,
    isImportant: false,
    fulfillingWish: false,
    inputValue: '',
    loading: false,
    saving: false,
    optionalOpen: false,
    categoryOptions: CATEGORY_OPTIONS,
    markerColors: MARKER_COLORS,
    markerEmojis: MARKER_EMOJIS,
    isEditing: false,
    saved: false,
    successVisible: false,
    successTitle: '',
    successDescription: '',
    successState: 'journey',
  },

  onLoad(query: Record<string, string>) {
    const status: FootprintStatus = query.status === 'wishlist' ? 'wishlist' : 'visited'
    const convertingWishlist = query.convert === '1'
    wx.setNavigationBarTitle({ title: status === 'wishlist' ? '新增想去' : '新增足迹' })

    const revisiting = Boolean(query.revisit)
    const sourceId = query.id || query.revisit
    if (sourceId) {
      this.setData({ id: revisiting ? undefined : sourceId, loading: true, isEditing: !revisiting })
      wx.showLoading({ title: '加载中…', mask: true })
      getFootprint(sourceId)
        .then((fp) => {
          if (!fp) {
            wx.showToast({ title: '足迹不存在', icon: 'none' })
            this.setData({ loading: false })
            wx.hideLoading()
            return
          }
          this.setData({
            id: revisiting ? undefined : fp.id,
            placeId: fp.placeId || placeKey(fp),
            status: convertingWishlist || revisiting ? 'visited' : fp.status,
            poiName: fp.poiName,
            address: fp.address || '',
            lat: fp.lat,
            lng: fp.lng,
            country: fp.country || '',
            province: fp.province || '',
            city: fp.city || '',
            district: fp.district || '',
            visitDate: convertingWishlist || revisiting ? todayKey() : fp.visitDate || (fp.status === 'visited' ? todayKey() : ''),
            photos: convertingWishlist || revisiting ? [] : fp.photos || [],
            originalPhotos: convertingWishlist || revisiting ? [] : fp.photos || [],
            mood: convertingWishlist || revisiting ? '' : fp.mood || '',
            category: fp.category || '',
            tags: revisiting ? [] : fp.tags || [],
            note: convertingWishlist || revisiting ? '' : fp.note || '',
            markerColor: fp.markerStyle?.color || MARKER_COLORS[0].value,
            markerEmoji: fp.markerStyle?.emoji || '',
            source: fp.source,
            wishlistCreatedAt: fp.wishlistCreatedAt,
            convertedFromWishlist: convertingWishlist || (!revisiting && !!fp.convertedFromWishlist),
            wishId: revisiting || convertingWishlist ? undefined : fp.wishId,
            fulfilledAt: revisiting || convertingWishlist ? undefined : fp.fulfilledAt,
            fulfilledVisitId: revisiting || convertingWishlist ? undefined : fp.fulfilledVisitId,
            isImportant: revisiting || convertingWishlist ? false : !!fp.isImportant,
            fulfillingWish: convertingWishlist,
            optionalOpen: convertingWishlist || revisiting,
            loading: false,
          })
          wx.setNavigationBarTitle({
            title: convertingWishlist ? '记录这次到访' : revisiting ? '再记一次' : fp.status === 'wishlist' ? '编辑想去' : fp.status === 'fulfilled' ? '编辑已实现愿望' : '编辑足迹',
          })
          wx.hideLoading()
        })
        .catch(() => {
          this.setData({ loading: false })
          wx.hideLoading()
          wx.showToast({ title: '加载失败', icon: 'none' })
        })
    } else {
      const baseData: Partial<PageData> = {
        status,
        visitDate: status === 'visited' ? todayKey() : undefined,
        markerColor: status === 'wishlist' ? MARKER_COLORS[1].value : MARKER_COLORS[0].value,
      }
      if (query.date && status === 'visited' && /^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
        baseData.visitDate = query.date
      }
      if (query.presetPoiName) {
        baseData.poiName = decodeURIComponent(query.presetPoiName)
      }
      if (query.presetLat) baseData.lat = Number(query.presetLat)
      if (query.presetLng) baseData.lng = Number(query.presetLng)
      if (status === 'wishlist') baseData.wishlistCreatedAt = Date.now()
      if (query.from === 'place') {
        const selected = wx.getStorageSync<Partial<FootprintDraft>>('sgj:quick-place')
        wx.removeStorageSync('sgj:quick-place')
        if (selected) {
          baseData.poiName = selected.poiName || baseData.poiName
          baseData.address = selected.address || ''
          baseData.lat = selected.lat
          baseData.lng = selected.lng
          baseData.city = selected.city || ''
          baseData.province = selected.province || ''
        }
      }
      this.setData(baseData as WechatMiniprogram.IAnyObject)

      const saved = loadDraft()
      if (saved && (saved.poiName || saved.note)) {
        wx.showModal({
          title: '恢复草稿',
          content: '检测到上次未保存的内容，是否恢复？',
          confirmText: '恢复',
          cancelText: '丢弃',
          success: (res) => {
            if (res.confirm) {
              this.setData({
                status: saved.status,
                placeId: saved.placeId,
                poiName: saved.poiName || this.data.poiName,
                address: saved.address || this.data.address,
                lat: saved.lat ?? this.data.lat,
                lng: saved.lng ?? this.data.lng,
                country: saved.country || this.data.country,
                province: saved.province || this.data.province,
                city: saved.city || this.data.city,
                district: saved.district || this.data.district,
                visitDate: saved.visitDate || this.data.visitDate,
                photos: saved.photos || this.data.photos,
                mood: saved.mood || this.data.mood,
                category: saved.category || this.data.category,
                tags: saved.tags || this.data.tags,
                note: saved.note || this.data.note,
                markerColor: saved.markerStyle?.color || this.data.markerColor,
                markerEmoji: saved.markerStyle?.emoji || this.data.markerEmoji,
                source: saved.source || this.data.source,
                wishlistCreatedAt: saved.wishlistCreatedAt,
              })
            } else {
              clearDraft()
            }
          },
        })
      }
    }
  },

  onUnload() {
    if (!this.data.saved && !this.data.id && (this.data.poiName || this.data.note || this.data.photos.length)) {
      const draft: FootprintDraft = {
        placeId: this.data.placeId,
        status: this.data.status,
        poiName: this.data.poiName,
        address: this.data.address || undefined,
        lat: this.data.lat,
        lng: this.data.lng,
        country: this.data.country || undefined,
        province: this.data.province || undefined,
        city: this.data.city || undefined,
        district: this.data.district || undefined,
        visitDate: this.data.visitDate,
        photos: this.data.photos,
        mood: this.data.mood || undefined,
        category: this.data.category || undefined,
        tags: this.data.tags,
        note: this.data.note || undefined,
        markerStyle: { color: this.data.markerColor, emoji: this.data.markerEmoji || undefined },
        source: this.data.source,
        wishlistCreatedAt: this.data.wishlistCreatedAt,
        convertedFromWishlist: this.data.convertedFromWishlist,
      }
      saveDraft(draft)
    }
  },

  toggleOptional() {
    this.setData({ optionalOpen: !this.data.optionalOpen })
  },

  onPoiNameInput(e: WechatMiniprogram.Input) {
    this.setData({ poiName: e.detail.value || '' })
  },

  onAddressInput(e: WechatMiniprogram.Input) {
    this.setData({ address: e.detail.value || '' })
  },

  onChooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          poiName: res.name || this.data.poiName || '',
          address: res.address || '',
          lat: res.latitude,
          lng: res.longitude,
        })
      },
      fail: () => {},
    })
  },

  onDateChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ visitDate: String(e.detail.value) })
  },

  onNoteInput(e: WechatMiniprogram.TextareaInput) {
    this.setData({ note: e.detail.value || '' })
  },

  onMoodChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ mood: e.detail.value })
  },

  selectCategory(
    e: WechatMiniprogram.TouchEvent & { currentTarget: { dataset: { value: string } } },
  ) {
    const value = e.currentTarget.dataset.value
    this.setData({ category: this.data.category === value ? '' : value })
  },

  onTagInput(e: WechatMiniprogram.Input) {
    this.setData({ inputValue: e.detail.value || '' })
  },

  addTag() {
    const tag = this.data.inputValue.trim()
    if (!tag) return
    if (this.data.tags.includes(tag)) {
      wx.showToast({ title: '标签已存在', icon: 'none' })
      return
    }
    if (this.data.tags.length >= 8) {
      wx.showToast({ title: '最多 8 个标签', icon: 'none' })
      return
    }
    this.setData({ tags: [...this.data.tags, tag], inputValue: '' })
  },

  removeTag(
    e: WechatMiniprogram.TouchEvent & { currentTarget: { dataset: { index: number } } },
  ) {
    const index = e.currentTarget.dataset.index
    const tags = [...this.data.tags]
    tags.splice(index, 1)
    this.setData({ tags })
  },

  selectMarkerColor(
    e: WechatMiniprogram.TouchEvent & { currentTarget: { dataset: { value: string } } },
  ) {
    this.setData({ markerColor: e.currentTarget.dataset.value })
  },

  selectMarkerEmoji(
    e: WechatMiniprogram.TouchEvent & { currentTarget: { dataset: { value: string } } },
  ) {
    const value = e.currentTarget.dataset.value
    this.setData({ markerEmoji: value === this.data.markerEmoji ? '' : value })
  },

  onPhotoAdd() {
    const remaining = 9 - this.data.photos.length
    if (remaining <= 0) {
      wx.showToast({ title: '最多 9 张照片', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        wx.showLoading({ title: '上传中…', mask: true })
        const tempPaths = res.tempFiles.map((f) => f.tempFilePath)
        try {
          const uploaded = await Promise.all(tempPaths.map((p) => uploadPhoto(p)))
          this.setData({ photos: [...this.data.photos, ...uploaded] })
        } catch (err) {
          wx.showToast({ title: '上传失败', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      },
      fail: () => {},
    })
  },

  onPhotoRemove(e: WechatMiniprogram.CustomEvent<{ index: number }>) {
    const index = (e.detail && e.detail.index) ?? 0
    const photos = [...this.data.photos]
    const [removed] = photos.splice(index, 1)
    if (removed && !this.data.originalPhotos.includes(removed)) {
      deletePhotos([removed]).catch(() => undefined)
    }
    this.setData({ photos })
  },

  async onSave() {
    if (this.data.saving) return
    if (!this.data.poiName.trim()) {
      wx.showToast({ title: '请填写地点', icon: 'none' })
      return
    }
    if (this.data.status === 'visited' && !this.data.visitDate) {
      wx.showToast({ title: '请选择日期', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    const draft: FootprintDraft = {
      id: this.data.id,
      placeId: this.data.placeId,
      status: this.data.status,
      poiName: this.data.poiName.trim(),
      address: this.data.address || undefined,
      lat: this.data.lat,
      lng: this.data.lng,
      country: this.data.country || undefined,
      province: this.data.province || undefined,
      city: this.data.city || undefined,
      district: this.data.district || undefined,
      visitDate: this.data.status === 'visited' ? this.data.visitDate : undefined,
      photos: this.data.photos,
      mood: this.data.mood || undefined,
      category: this.data.category || undefined,
      tags: this.data.tags,
      note: this.data.note || undefined,
      markerStyle: { color: this.data.markerColor, emoji: this.data.markerEmoji || undefined },
      source: this.data.source,
      wishlistCreatedAt: this.data.wishlistCreatedAt,
      convertedFromWishlist: this.data.convertedFromWishlist,
      wishId: this.data.wishId,
      fulfilledAt: this.data.fulfilledAt,
      fulfilledVisitId: this.data.fulfilledVisitId,
      isImportant: this.data.isImportant,
    }
    try {
      const result = this.data.fulfillingWish && this.data.id
        ? await fulfillWishlistFootprint(this.data.id, draft)
        : null
      const saved = result ? result.visit : await saveFootprint(draft)
      const removedLocalPhotos = this.data.originalPhotos.filter(
        (path) => path.startsWith('wxfile://') && !this.data.photos.includes(path),
      )
      if (removedLocalPhotos.length) await deletePhotos(removedLocalPhotos)
      clearDraft()
      this.setData({ id: saved.id, saved: true })
      if (result) {
        const days = Math.max(0, Math.floor((Date.now() - (result.wish.wishlistCreatedAt || result.wish.createdAt)) / 86_400_000))
        this.setData({
          saving: false,
          successVisible: true,
          successTitle: '愿望实现了',
          successDescription: `这个愿望等了 ${days} 天。今天的回忆已经留下，未来还能在这里重逢。`,
          successState: 'highlight',
        })
      } else {
        const all = await listFootprints().catch(() => [saved])
        const count = visitsAtPlace(all, saved).length
        this.setData({
          saving: false,
          successVisible: true,
          successTitle: count > 1 ? `第 ${count} 次来到这里` : '这个地方亮起来了',
          successDescription: count > 1 ? '熟悉的地方，又多了一段新的故事。' : '小拾已经把这段生活收进你的地图。',
          successState: count > 1 ? 'companion' : 'journey',
        })
      }
    } catch (err) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      this.setData({ saving: false })
    }
  },

  onSuccessClose() {
    this.setData({ successVisible: false })
    wx.navigateBack()
  },

  onDelete() {
    if (!this.data.id) return
    wx.showModal({
      title: '删除足迹',
      content: '删除后无法恢复，确认删除？',
      confirmColor: '#C0524A',
      confirmText: '删除',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中…', mask: true })
        try {
          await deleteFootprint(this.data.id!)
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
