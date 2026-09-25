import type { FootprintDraftAI } from '../../domain/types'
import { generateAIDraft, saveFootprint, uploadPhoto, deletePhotos } from '../../services/repository'
import { CATEGORY_OPTIONS } from '../../data/options'
import { todayKey } from '../../utils/date'

Page({
  data: {
    text: '',
    photos: [] as string[],
    generating: false,
    saving: false,
    stage: 'input' as 'input' | 'preview',
    poiName: '',
    address: '',
    lat: undefined as number | undefined,
    lng: undefined as number | undefined,
    visitDate: todayKey(),
    mood: '',
    category: '',
    tags: [] as string[],
    note: '',
    confidence: 0,
    needsPoiConfirmation: true,
    poiConfirmed: false,
    dateWasDefaulted: false,
    categoryOptions: CATEGORY_OPTIONS,
  },

  onTextInput(e: WechatMiniprogram.TextareaInput) {
    this.setData({ text: e.detail.value || '' })
  },

  onPoiInput(e: WechatMiniprogram.Input) {
    this.setData({ poiName: e.detail.value || '', poiConfirmed: false })
  },

  onNoteInput(e: WechatMiniprogram.TextareaInput) {
    this.setData({ note: e.detail.value || '' })
  },

  onDateChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ visitDate: String(e.detail.value), dateWasDefaulted: false })
  },

  onMoodChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ mood: e.detail.value })
  },

  selectCategory(e: WechatMiniprogram.TouchEvent) {
    const value = String(e.currentTarget.dataset.value || '')
    this.setData({ category: this.data.category === value ? '' : value })
  },

  async onPhotoAdd() {
    const remaining = 3 - this.data.photos.length
    if (remaining <= 0) return
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        wx.showLoading({ title: '读取照片…', mask: true })
        try {
          const uploaded = await Promise.all(res.tempFiles.map((f) => uploadPhoto(f.tempFilePath)))
          this.setData({ photos: [...this.data.photos, ...uploaded] })
        } catch {
          wx.showToast({ title: '照片处理失败', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      },
    })
  },

  onPhotoRemove(e: WechatMiniprogram.CustomEvent<{ index: number }>) {
    const photos = [...this.data.photos]
    const [removed] = photos.splice(e.detail.index, 1)
    if (removed) deletePhotos([removed]).catch(() => undefined)
    this.setData({ photos })
  },

  async onGenerateDraft() {
    const text = this.data.text.trim()
    if (!text) {
      wx.showToast({ title: '先告诉小拾发生了什么', icon: 'none' })
      return
    }
    if (this.data.generating) return
    this.setData({ generating: true })
    try {
      const draft: FootprintDraftAI = await generateAIDraft(text, this.data.photos)
      const dateWasDefaulted = Boolean(draft.dateWasDefaulted || !draft.visitDate)
      this.setData({
        stage: 'preview',
        poiName: draft.poiName || '',
        address: draft.address || '',
        lat: draft.lat,
        lng: draft.lng,
        visitDate: draft.visitDate || todayKey(),
        mood: draft.mood || '',
        category: draft.category || '',
        tags: draft.tags || [],
        note: draft.note || text,
        photos: draft.photos || this.data.photos,
        confidence: Math.round((draft.confidence || 0) * 100),
        needsPoiConfirmation: draft.needsPoiConfirmation,
        poiConfirmed: !draft.needsPoiConfirmation,
        dateWasDefaulted,
        generating: false,
      })
    } catch {
      this.setData({ generating: false })
      wx.showToast({ title: '暂时没整理好，请重试', icon: 'none' })
    }
  },

  choosePoi() {
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          poiName: res.name || this.data.poiName,
          address: res.address || '',
          lat: res.latitude,
          lng: res.longitude,
          poiConfirmed: true,
        })
      },
    })
  },

  confirmPoi() {
    if (!this.data.poiName.trim()) {
      wx.showToast({ title: '请先补充地点', icon: 'none' })
      return
    }
    this.setData({ poiConfirmed: true })
  },

  backToInput() {
    this.setData({ stage: 'input' })
  },

  async onConfirmSave() {
    if (!this.data.poiName.trim()) {
      wx.showToast({ title: '请补充地点', icon: 'none' })
      return
    }
    if (this.data.needsPoiConfirmation && !this.data.poiConfirmed) {
      wx.showToast({ title: '请先确认地点', icon: 'none' })
      return
    }
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      const saved = await saveFootprint({
        status: 'visited',
        poiName: this.data.poiName.trim(),
        address: this.data.address || undefined,
        lat: this.data.lat,
        lng: this.data.lng,
        visitDate: this.data.visitDate,
        photos: this.data.photos,
        mood: this.data.mood || undefined,
        category: this.data.category || undefined,
        tags: this.data.tags,
        note: this.data.note || undefined,
        markerStyle: { color: '#5B6CFF' },
        visibility: 'private',
        source: 'ai',
        convertedFromWishlist: false,
      })
      const app = getApp<IAppOption>()
      app.globalData.footprints = [saved, ...(app.globalData.footprints || []).filter((fp) => fp.id !== saved.id)]
      app.globalData.footprintsCachedAt = Date.now()
      wx.showToast({ title: '已确认并保存', icon: 'success' })
      setTimeout(() => wx.redirectTo({ url: `/pages/footprint-detail/index?id=${saved.id}` }), 600)
    } catch {
      this.setData({ saving: false })
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    }
  },
})
