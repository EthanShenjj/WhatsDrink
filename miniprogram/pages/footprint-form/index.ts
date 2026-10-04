import type { Footprint, FootprintDraft, FootprintStatus } from '../../domain/types'
import {
  saveFootprint,
  fulfillWishlistFootprint,
  getFootprintSnapshot,
  deleteFootprint,
  getFootprint,
  uploadFootprintPhoto,
  deletePhotos,
  saveDraft,
  loadDraft,
  clearDraft,
} from '../../services/repository'
import { createDefaultFootprint } from '../../utils/footprint'
import { placeKey, visitsAtPlace } from '../../utils/footprint'
import { todayKey, dateKey } from '../../utils/date'
import {
  CATEGORY_OPTIONS,
  MARKER_COLORS,
  MARKER_EMOJIS,
  moodLabel,
} from '../../data/options'
import { installUpdatePerformanceLogger, recordInteraction } from '../../utils/performance'
import { hasMapCoordinates } from '../../utils/map'
import { CHECKIN_SOURCE_STORAGE_KEY } from '../../utils/checkin'
import { createId } from '../../utils/id'
import { locationRegion, shortProvince, shortCity, MAP_TARGET_STORAGE_KEY } from '../../utils/location'
import { provinceAt } from '../../utils/province-map'
import { trackProductEvent } from '../../services/product-events'

const MAP_MODE_STORAGE_KEY = 'sgj:map-mode'

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
  photoThumbs: string[]
  originalPhotos: string[]
  originalPhotoThumbs: string[]
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
  optionalSummary: string
  canSave: boolean
  draftRestorable: boolean
  draftDiscarded: boolean
  pendingDraft?: Partial<FootprintDraft>
  dateShortcuts: Array<{ label: string; value: string }>
  pendingUploads: string[]
  uploadFailedCount: number
  uploadRetrying: boolean
  categoryOptions: typeof CATEGORY_OPTIONS
  markerColors: typeof MARKER_COLORS
  markerEmojis: typeof MARKER_EMOJIS
  isEditing: boolean
  saved: boolean
  successVisible: boolean
  successClosing: boolean
  successTitle: string
  successDescription: string
  successState: 'journey' | 'highlight' | 'companion'
  isCheckin: boolean
  checkinDistance: number
}

Page<PageData, WechatMiniprogram.IAnyObject>({
  requestId: '',
  uploadInProgress: false,
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
    photoThumbs: [],
    originalPhotos: [],
    originalPhotoThumbs: [],
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
    optionalSummary: '',
    canSave: false,
    draftRestorable: false,
    draftDiscarded: false,
    pendingDraft: undefined,
    dateShortcuts: [],
    pendingUploads: [],
    uploadFailedCount: 0,
    uploadRetrying: false,
    categoryOptions: CATEGORY_OPTIONS,
    markerColors: MARKER_COLORS,
    markerEmojis: MARKER_EMOJIS,
    isEditing: false,
    saved: false,
    successVisible: false,
    successClosing: false,
    successTitle: '',
    successDescription: '',
    successState: 'journey',
    isCheckin: false,
    checkinDistance: 0,
  },

  onLoad(query: Record<string, string>) {
    this.requestId = createId('req')
    installUpdatePerformanceLogger(this, 'footprint-form')
    const status: FootprintStatus = query.status === 'wishlist' ? 'wishlist' : 'visited'
    const convertingWishlist = query.convert === '1'
    const isCheckin = query.checkin === '1'
    const checkinDistance = Number.isFinite(Number(query.distance))
      ? Math.max(0, Math.round(Number(query.distance)))
      : 0
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    this.setData({
      isCheckin,
      checkinDistance,
      dateShortcuts: [
        { label: '今天', value: todayKey() },
        { label: '昨天', value: dateKey(yesterday) },
      ],
    })
    wx.setNavigationBarTitle({ title: isCheckin ? '到访打卡' : status === 'wishlist' ? '新增想去' : '新增足迹' })

    const revisiting = Boolean(query.revisit)
    const sourceId = query.id || query.revisit
    if (sourceId) {
      const checkinSource = isCheckin
        ? wx.getStorageSync<Footprint | undefined>(CHECKIN_SOURCE_STORAGE_KEY)
        : undefined
      if (isCheckin) wx.removeStorageSync(CHECKIN_SOURCE_STORAGE_KEY)
      if (checkinSource?.id === sourceId) {
        this.applySourceFootprint(checkinSource, revisiting, convertingWishlist, isCheckin)
        return
      }
      this.setData({ id: revisiting ? undefined : sourceId, loading: true, isEditing: !revisiting })
      wx.showLoading({ title: '加载中…', mask: true })
      getFootprint(sourceId)
        .then((fp) => {
          if (!fp) {
            wx.showToast({ title: '足迹不存在', icon: 'none' })
            wx.hideLoading()
            wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/map/index' }) })
            return
          }
          this.applySourceFootprint(fp, revisiting, convertingWishlist, isCheckin)
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
          baseData.country = selected.country || ''
          baseData.district = selected.district || ''
        }
      }
      this.setData(baseData as WechatMiniprogram.IAnyObject)
      this.updateFormState()

      const saved = loadDraft()
      if (saved && (saved.poiName || saved.note)) {
        this.setData({ draftRestorable: true, pendingDraft: saved })
      }
    }
  },

  applySourceFootprint(
    fp: Footprint,
    revisiting: boolean,
    convertingWishlist: boolean,
    isCheckin: boolean,
  ) {
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
      photoThumbs: convertingWishlist || revisiting
        ? []
        : fp.photoThumbs?.length ? fp.photoThumbs : fp.photos || [],
      originalPhotos: convertingWishlist || revisiting ? [] : fp.photos || [],
      originalPhotoThumbs: convertingWishlist || revisiting
        ? []
        : fp.photoThumbs?.length ? fp.photoThumbs : fp.photos || [],
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
      isEditing: !revisiting,
    })
    wx.setNavigationBarTitle({
      title: isCheckin ? '到访打卡' : convertingWishlist ? '记录这次到访' : revisiting ? '再记一次' : fp.status === 'wishlist' ? '编辑想去' : fp.status === 'fulfilled' ? '编辑已实现愿望' : '编辑足迹',
    })
    this.updateFormState()
  },

  updateFormState() {
    const d = this.data
    const canSave = Boolean(d.poiName.trim())
    const parts: string[] = []
    if (d.status === 'visited' && d.photos.length) parts.push(`${d.photos.length} 张照片`)
    if (d.mood) parts.push(moodLabel(d.mood))
    if (d.tags.length) parts.push(`${d.tags.length} 个标签`)
    if (d.note && d.note.trim()) parts.push('有短记')
    const optionalSummary = parts.join(' · ')
    if (canSave !== d.canSave || optionalSummary !== d.optionalSummary) {
      this.setData({ canSave, optionalSummary })
    }
  },

  onRestoreDraft() {
    const saved = this.data.pendingDraft
    if (!saved) return
    this.requestId = saved.clientRequestId || this.requestId || createId('req')
    this.setData({
      status: saved.status || this.data.status,
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
      photoThumbs: saved.photoThumbs || this.data.photoThumbs,
      mood: saved.mood || this.data.mood,
      category: saved.category || this.data.category,
      tags: saved.tags || this.data.tags,
      note: saved.note || this.data.note,
      markerColor: saved.markerStyle?.color || this.data.markerColor,
      markerEmoji: saved.markerStyle?.emoji || this.data.markerEmoji,
      source: saved.source || this.data.source,
      wishlistCreatedAt: saved.wishlistCreatedAt,
      draftRestorable: false,
      pendingDraft: undefined,
      optionalOpen: Boolean(saved.note || saved.tags?.length),
    })
    this.updateFormState()
  },

  onDiscardDraft() {
    clearDraft()
    this.setData({ draftRestorable: false, pendingDraft: undefined, draftDiscarded: true })
  },

  onUnload() {
    if (
      !this.data.saved &&
      !this.data.draftDiscarded &&
      !this.data.id &&
      (this.data.poiName || this.data.note || this.data.photos.length)
    ) {
      const draft: FootprintDraft = {
        clientRequestId: this.requestId,
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
        photoThumbs: this.data.photoThumbs,
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
    this.updateFormState()
  },

  onAddressInput(e: WechatMiniprogram.Input) {
    this.setData({ address: e.detail.value || '' })
  },

  onChooseLocation() {
    recordInteraction('form.location')
    wx.chooseLocation({
      success: (res) => {
        const region = locationRegion(res.address || '')
        const province = region.province || provinceAt(res.latitude, res.longitude) || ''
        const samePlace = res.name === this.data.poiName && typeof this.data.lat === 'number'
          && Math.abs(res.latitude - this.data.lat) < 0.0001 && typeof this.data.lng === 'number'
          && Math.abs(res.longitude - this.data.lng) < 0.0001
        this.setData({
          placeId: samePlace ? this.data.placeId : undefined,
          country: region.country || (province ? '中国' : ''),
          province,
          city: region.city || (['北京', '上海', '天津', '重庆'].includes(province) ? province : ''),
          district: region.district || '',
          poiName: res.name || this.data.poiName || '',
          address: res.address || '',
          lat: res.latitude,
          lng: res.longitude,
        })
        this.updateFormState()
      },
      fail: (error) => {
        if (!error.errMsg.includes('cancel')) wx.showToast({ title: '位置选择失败，可先记录再补充', icon: 'none' })
      },
    })
  },

  onClearLocation() {
    this.setData({ placeId: undefined, address: '', lat: undefined, lng: undefined, country: '', province: '', city: '', district: '' })
  },

  onRegionChange(e: WechatMiniprogram.PickerChange) {
    const values = e.detail.value as string[]
    this.setData({ country: '中国', province: shortProvince(values[0]), city: shortCity(values[1]), district: values[2] || '' })
  },

  onDateChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ visitDate: String(e.detail.value) })
  },

  onDateShortcutTap(
    e: WechatMiniprogram.TouchEvent & { currentTarget: { dataset: { value: string } } },
  ) {
    this.setData({ visitDate: e.currentTarget.dataset.value })
  },

  onNoteInput(e: WechatMiniprogram.TextareaInput) {
    this.setData({ note: e.detail.value || '' })
    this.updateFormState()
  },

  onMoodChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const value = e.detail.value
    this.setData({ mood: value === this.data.mood ? '' : value })
    this.updateFormState()
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
    this.updateFormState()
  },

  removeTag(
    e: WechatMiniprogram.TouchEvent & { currentTarget: { dataset: { index: number } } },
  ) {
    const index = e.currentTarget.dataset.index
    const tags = [...this.data.tags]
    tags.splice(index, 1)
    this.setData({ tags })
    this.updateFormState()
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

  async uploadPhotos(tempPaths: string[], retry = false) {
    if (!tempPaths.length || this.uploadInProgress || this.data.saving) return
    this.uploadInProgress = true
    const previousFailures = retry ? [] : this.data.pendingUploads.slice(0, this.data.uploadFailedCount)
    wx.showLoading({ title: '上传中…', mask: true })
    this.setData({ pendingUploads: [...previousFailures, ...tempPaths], uploadFailedCount: previousFailures.length })
    const uploaded: Array<{ photo: string; thumbnail: string }> = []
    const failed: string[] = []
    try {
      for (let index = 0; index < tempPaths.length; index += 2) {
        const batch = tempPaths.slice(index, index + 2)
        const results = await Promise.allSettled(batch.map((path) => uploadFootprintPhoto(path)))
        results.forEach((result, resultIndex) => {
          if (result.status === 'fulfilled') uploaded.push(result.value)
          else failed.push(batch[resultIndex])
        })
        const completed = uploaded.splice(0)
        this.setData({
          photos: [...this.data.photos, ...completed.map((item) => item.photo)],
          photoThumbs: [...this.data.photoThumbs, ...completed.map((item) => item.thumbnail)],
          pendingUploads: [...previousFailures, ...failed, ...tempPaths.slice(index + batch.length)],
        })
      }
      const remaining = [...previousFailures, ...failed]
      this.setData({ pendingUploads: remaining, uploadFailedCount: remaining.length })
      this.updateFormState()
      if (remaining.length) wx.showToast({ title: '部分照片上传失败，可点击重试', icon: 'none' })
    } finally {
      this.uploadInProgress = false
      wx.hideLoading()
    }
  },

  onPhotoAdd() {
    recordInteraction('form.photo')
    if (this.data.saving || this.uploadInProgress) return
    const remaining = 9 - this.data.photos.length - this.data.pendingUploads.length
    if (remaining <= 0) {
      wx.showToast({ title: '最多 9 张照片', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        this.uploadPhotos(res.tempFiles.map((f) => f.tempFilePath))
      },
      fail: () => {},
    })
  },

  onRetryUpload() {
    if (this.data.uploadRetrying || this.uploadInProgress || this.data.saving) return
    const tempPaths = this.data.pendingUploads
    if (!tempPaths.length) return
    this.setData({ uploadRetrying: true })
    this.uploadPhotos(tempPaths, true)
      .finally(() => this.setData({ uploadRetrying: false }))
  },

  onPhotoRemove(e: WechatMiniprogram.CustomEvent<{ index: number; pendingIndex?: number }>) {
    if (this.data.saving || this.uploadInProgress) return
    const pendingIndex = e.detail?.pendingIndex ?? -1
    if (pendingIndex >= 0 && pendingIndex < this.data.pendingUploads.length) {
      const pendingUploads = [...this.data.pendingUploads]
      pendingUploads.splice(pendingIndex, 1)
      this.setData({
        pendingUploads,
        uploadFailedCount: Math.max(0, this.data.uploadFailedCount - (pendingIndex < this.data.uploadFailedCount ? 1 : 0)),
      })
      return
    }
    const index = (e.detail && e.detail.index) ?? 0
    const photos = [...this.data.photos]
    const photoThumbs = [...this.data.photoThumbs]
    const [removed] = photos.splice(index, 1)
    const [removedThumbnail] = photoThumbs.splice(index, 1)
    if (removed && !this.data.originalPhotos.includes(removed)) {
      deletePhotos([removed, removedThumbnail]).catch(() => undefined)
    }
    this.setData({ photos, photoThumbs })
    this.updateFormState()
  },

  async onSave() {
    recordInteraction('form.save')
    if (this.data.saving) return
    if (!this.data.poiName.trim()) {
      wx.showToast({ title: '请填写地点', icon: 'none' })
      return
    }
    if (this.data.status === 'visited' && !this.data.visitDate) {
      wx.showToast({ title: '请选择日期', icon: 'none' })
      return
    }
    if (this.data.isCheckin && !hasMapCoordinates(this.data)) {
      wx.showModal({
        title: '选择地图位置',
        content: '需要选择具体位置，保存后才能立即在地图上显示标记。',
        confirmText: '选择位置',
        cancelText: '稍后再说',
        success: ({ confirm }) => {
          if (confirm) this.onChooseLocation()
          else wx.showToast({ title: '选择位置后才能完成打卡', icon: 'none' })
        },
      })
      return
    }
    if (this.data.pendingUploads.length || this.data.uploadRetrying) {
      wx.showToast({ title: '请等待照片上传完成', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    const draft: FootprintDraft = {
      clientRequestId: this.requestId || (this.requestId = createId('req')),
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
      photoThumbs: this.data.photoThumbs,
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
      if (saved.status === 'visited' && !this.data.isEditing) trackProductEvent('place_added')
      const removedLocalPhotos = this.data.originalPhotos.filter(
        (path) => path.startsWith('wxfile://') && !this.data.photos.includes(path),
      )
      const removedLocalThumbs = this.data.originalPhotoThumbs.filter(
        (path) => path.startsWith('wxfile://') && !this.data.photoThumbs.includes(path),
      )
      if (removedLocalPhotos.length || removedLocalThumbs.length) {
        deletePhotos([...removedLocalPhotos, ...removedLocalThumbs]).catch(() => undefined)
      }
      clearDraft()
      this.setData({ id: saved.id, saved: true })
      const pages = getCurrentPages()
      const previousPage = pages[pages.length - 2]
      if (previousPage?.route === 'pages/map/index') {
        wx.setStorageSync(MAP_MODE_STORAGE_KEY, saved.status === 'visited' ? 'visited' : 'wishlist')
        if (hasMapCoordinates(saved)) wx.setStorageSync(MAP_TARGET_STORAGE_KEY, saved)
      }
      wx.vibrateShort({ type: 'light', fail: () => {} })
      if (this.data.isCheckin) {
        const distanceCopy = this.data.checkinDistance > 0
          ? `定位距离约 ${this.data.checkinDistance} 米，`
          : ''
        this.setData({
          saving: false,
          successVisible: true,
          successTitle: '打卡成功',
          successDescription: `${distanceCopy}已在 ${saved.poiName} 完成本次到访打卡，并加入你的个人足迹。${saved.pendingSync ? '已保存本机，联网后同步。' : ''}`,
          successState: result ? 'highlight' : 'companion',
        })
      } else if (result) {
        const days = Math.max(0, Math.floor((Date.now() - (result.wish.wishlistCreatedAt || result.wish.createdAt)) / 86_400_000))
        this.setData({
          saving: false,
          successVisible: true,
          successTitle: '愿望实现了',
          successDescription: `这个愿望等了 ${days} 天。今天的回忆已经留下，未来还能在这里重逢。`,
          successState: 'highlight',
        })
      } else {
        const all = getFootprintSnapshot() || [saved]
        const count = visitsAtPlace(all, saved).length
        this.setData({
          saving: false,
          successVisible: true,
          successTitle: saved.status === 'wishlist' ? '已收藏想去地点' : !hasMapCoordinates(saved) ? '已留下这段记录' : this.data.isEditing ? '记录已更新' : count > 1 ? `第 ${count} 次来到这里` : '这个地方亮起来了',
          successDescription: saved.pendingSync ? '已保存到本机，联网后自动同步。' : !hasMapCoordinates(saved) ? '可稍后编辑补充位置，让它出现在地图上。' : count > 1 ? '熟悉的地方，又多了一段新的故事。' : 'Lumi 已经把这段生活收进你的地图。',
          successState: count > 1 ? 'companion' : 'journey',
        })
      }
    } catch (err) {
      wx.showToast({ title: err instanceof Error ? err.message : '保存失败，请重试', icon: 'none' })
      this.setData({ saving: false })
    }
  },

  preventMove() {
    /* 阻止成功弹层下的页面滚动穿透 */
  },

  onSuccessClose() {
    if (this.data.successClosing) return
    this.setData({ successVisible: false, successClosing: true })
    setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/map/index' }) }), 240)
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
          const pages = getCurrentPages()
          const previous = pages[pages.length - 2]
          setTimeout(() => wx.navigateBack({
            delta: previous?.route === 'pages/footprint-detail/index' ? 2 : 1,
            fail: () => wx.switchTab({ url: '/pages/map/index' }),
          }), 500)
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      },
    })
  },
})
