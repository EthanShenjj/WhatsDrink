import type { Footprint, TimeCapsule, TimeCapsuleDraft } from '../../domain/types'
import { CAPSULE_TEMPLATE_ID } from '../../services/config'
import {
  deleteTimeCapsule,
  deletePhotos,
  ensureProfile,
  listFootprints,
  listTimeCapsules,
  saveTimeCapsule,
  unlockTimeCapsule,
  uploadPhoto,
} from '../../services/repository'
import { todayKey } from '../../utils/date'
import { hasTimeCapsuleCapacity } from '../../utils/payment'

Page({
  data: {
    capsules: [] as TimeCapsule[],
    footprints: [] as Footprint[],
    loading: true,
    formVisible: false,
    saving: false,
    id: '',
    title: '',
    text: '',
    photos: [] as string[],
    footprintId: '',
    footprintIndex: 0,
    unlockDate: todayKey(),
    today: todayKey(),
    wantsReminder: false,
    reminderAvailable: Boolean(CAPSULE_TEMPLATE_ID),
    selectedCapsule: null as TimeCapsule | null,
    isPlus: false,
  },

  onLoad(query: Record<string, string>) {
    if (query.footprintId) {
      this.setData({ formVisible: true, footprintId: query.footprintId })
    }
  },

  onShow() {
    this.loadAll()
  },

  async loadAll() {
    this.setData({ loading: true, today: todayKey() })
    try {
      const [capsules, footprints, profile] = await Promise.all([
        listTimeCapsules(),
        listFootprints(),
        ensureProfile(),
      ])
      const unlocked = await Promise.all(capsules.map(async (capsule) => {
        if (capsule.status === 'locked' && capsule.unlockDate <= todayKey()) {
          try { return await unlockTimeCapsule(capsule.id) } catch { return capsule }
        }
        return capsule
      }))
      const linkable = footprints.filter(
        (fp) => fp.status === 'visited' || fp.status === 'fulfilled',
      )
      this.setData({
        capsules: unlocked,
        footprints: linkable,
        footprintIndex: Math.max(0, linkable.findIndex((fp) => fp.id === this.data.footprintId)),
        isPlus: Boolean(profile.growth?.plusUntil && profile.growth.plusUntil > Date.now()),
        loading: false,
      })
      if (this.data.formVisible && !this.data.id && !hasTimeCapsuleCapacity(unlocked.length, profile.growth)) {
        this.setData({ formVisible: false })
        this.showMembershipOffer()
      }
    } catch {
      this.setData({ loading: false })
      wx.showToast({ title: '胶囊加载失败', icon: 'none' })
    }
  },

  onNew() {
    if (!hasTimeCapsuleCapacity(
      this.data.capsules.length,
      this.data.isPlus ? { plusUntil: Date.now() + 1 } : undefined,
    )) {
      this.showMembershipOffer()
      return
    }
    this.setData({
      formVisible: true,
      id: '',
      title: '',
      text: '',
      photos: [],
      footprintId: '',
      footprintIndex: 0,
      unlockDate: todayKey(),
      wantsReminder: false,
      selectedCapsule: null,
    })
  },

  showMembershipOffer() {
    wx.showModal({
      title: '三个胶囊已经装满啦',
      content: '免费版可以保存 3 个时光胶囊。开通拾光+ 后，可以继续为未来封存回忆。',
      confirmText: '看看拾光+',
      cancelText: '暂不需要',
      success: (result) => {
        if (result.confirm) wx.navigateTo({ url: '/pages/membership/index' })
      },
    })
  },

  onCancel() {
    this.setData({ formVisible: false })
  },

  onTitleInput(e: WechatMiniprogram.Input) {
    this.setData({ title: e.detail.value || '' })
  },

  onTextInput(e: WechatMiniprogram.TextareaInput) {
    this.setData({ text: e.detail.value || '' })
  },

  onDateChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ unlockDate: String(e.detail.value) })
  },

  onFootprintChange(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value)
    this.setData({ footprintIndex: index, footprintId: this.data.footprints[index]?.id || '' })
  },

  onReminderChange(e: WechatMiniprogram.SwitchChange) {
    this.setData({ wantsReminder: e.detail.value })
  },

  onPhotoAdd() {
    const remaining = 9 - this.data.photos.length
    if (remaining <= 0) return
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (result) => {
        try {
          const uploaded = await Promise.all(result.tempFiles.map((file) => uploadPhoto(file.tempFilePath)))
          this.setData({ photos: [...this.data.photos, ...uploaded] })
        } catch {
          wx.showToast({ title: '照片处理失败', icon: 'none' })
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

  async requestReminder(): Promise<string | undefined> {
    if (!this.data.wantsReminder || !CAPSULE_TEMPLATE_ID) return undefined
    return new Promise((resolve) => {
      wx.requestSubscribeMessage({
        tmplIds: [CAPSULE_TEMPLATE_ID],
        success: (result) => resolve(result[CAPSULE_TEMPLATE_ID] === 'accept' ? CAPSULE_TEMPLATE_ID : undefined),
        fail: () => resolve(undefined),
      })
    })
  },

  async onSave() {
    if (this.data.saving) return
    const title = this.data.title.trim()
    if (!title) {
      wx.showToast({ title: '请填写胶囊标题', icon: 'none' })
      return
    }
    if (!this.data.text.trim() && !this.data.footprintId && !this.data.photos.length) {
      wx.showToast({ title: '请写下留言或选择一条足迹', icon: 'none' })
      return
    }
    if (this.data.unlockDate < todayKey()) {
      wx.showToast({ title: '解锁日期不能早于今天', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      const subscriptionId = await this.requestReminder()
      const draft: TimeCapsuleDraft = {
        title,
        text: this.data.text.trim() || undefined,
        photos: this.data.photos,
        footprintId: this.data.footprintId || undefined,
        unlockDate: this.data.unlockDate,
        status: 'locked',
        subscriptionId,
      }
      await saveTimeCapsule(draft)
      this.setData({ saving: false, formVisible: false })
      await this.loadAll()
      wx.showToast({ title: '已封存回忆', icon: 'success' })
    } catch (error) {
      this.setData({ saving: false })
      wx.showToast({ title: error instanceof Error ? error.message : '保存失败', icon: 'none' })
    }
  },

  onCapsuleTap(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    const capsule = this.data.capsules.find((item) => item.id === id)
    if (!capsule) return
    if (capsule.status === 'locked') {
      wx.showToast({ title: `${capsule.unlockDate} 才能打开`, icon: 'none' })
      return
    }
    this.setData({ selectedCapsule: capsule })
  },

  onCloseDetail() {
    this.setData({ selectedCapsule: null })
  },

  onDelete(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    wx.showModal({
      title: '删除时光胶囊',
      content: '删除后无法恢复，确认删除？',
      confirmText: '删除',
      confirmColor: '#C0524A',
      success: async (result) => {
        if (!result.confirm) return
        try {
          await deleteTimeCapsule(id)
          this.setData({ selectedCapsule: null })
          await this.loadAll()
        } catch {
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      },
    })
  },
})
