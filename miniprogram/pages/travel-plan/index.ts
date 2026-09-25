import type { Footprint, TravelDayPlan, TravelPlan, TravelPlanDraft } from '../../domain/types'
import { deleteTravelPlan, listFootprints, listTravelPlans, saveTravelPlan } from '../../services/repository'

interface DayView {
  day: number
  places: string[]
}

const splitPreferences = (value: string): string[] =>
  [...new Set(value.split(/[，,、\s]+/).map((part) => part.trim()).filter(Boolean))].slice(0, 10)

Page({
  data: {
    id: '',
    title: '',
    city: '',
    days: 2,
    preferencesInput: '',
    selectedIds: [] as string[],
    wishlist: [] as Footprint[],
    visibleWishlist: [] as Array<Footprint & { selected: boolean }>,
    dayPlans: [] as TravelDayPlan[],
    dayViews: [] as DayView[],
    status: 'planning' as TravelPlan['status'],
    loading: true,
    saving: false,
    isEditing: false,
  },

  async onLoad(query: Record<string, string>) {
    try {
      const [footprints, plans] = await Promise.all([listFootprints(), listTravelPlans()])
      const wishlist = footprints.filter((fp) => fp.status === 'wishlist')
      const plan = query.id ? plans.find((item) => item.id === query.id) : undefined
      if (query.id && !plan) wx.showToast({ title: '计划不存在', icon: 'none' })
      this.setData({
        id: plan?.id || '',
        title: plan?.title || '',
        city: plan?.city || '',
        days: plan?.days || 2,
        preferencesInput: plan?.preferences.join('，') || '',
        selectedIds: plan?.poiIds || [],
        dayPlans: plan?.dayPlans || [],
        status: plan?.status || 'planning',
        wishlist,
        isEditing: Boolean(plan),
        loading: false,
      })
      this.refreshViews()
    } catch {
      this.setData({ loading: false })
      wx.showToast({ title: '计划加载失败', icon: 'none' })
    }
  },

  onTitleInput(e: WechatMiniprogram.Input) {
    this.setData({ title: e.detail.value || '' })
  },

  onCityInput(e: WechatMiniprogram.Input) {
    this.setData({ city: e.detail.value || '' })
    this.refreshViews()
  },

  onDaysInput(e: WechatMiniprogram.Input) {
    const days = Math.max(1, Math.min(30, Number(e.detail.value) || 1))
    this.setData({ days })
  },

  onPreferencesInput(e: WechatMiniprogram.Input) {
    this.setData({ preferencesInput: e.detail.value || '' })
  },

  onStatusChange(e: WechatMiniprogram.PickerChange) {
    const statuses: TravelPlan['status'][] = ['planning', 'ongoing', 'completed']
    const status = statuses[Number(e.detail.value)] || 'planning'
    this.setData({ status })
  },

  onTogglePoi(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    const selected = new Set<string>(this.data.selectedIds)
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    this.setData({ selectedIds: [...selected], dayPlans: [], dayViews: [] })
    this.refreshViews()
  },

  refreshViews() {
    const city = this.data.city.trim()
    const source = city
      ? this.data.wishlist.filter((fp) => fp.city === city || fp.poiName.includes(city))
      : this.data.wishlist
    const visibleWishlist = source.map((fp) => ({
      ...fp,
      selected: this.data.selectedIds.includes(fp.id),
    }))
    const names = new Map(this.data.wishlist.map((fp) => [fp.id, fp.poiName]))
    const dayViews = this.data.dayPlans.map((plan) => ({
      day: plan.day,
      places: plan.poiIds.map((id) => names.get(id) || '已转为足迹的地点'),
    }))
    this.setData({ visibleWishlist, dayViews })
  },

  onGenerate() {
    const days = Math.max(1, Math.min(30, Number(this.data.days) || 1))
    const ids = this.data.selectedIds
    if (!ids.length) {
      wx.showToast({ title: '请先选择想去地点', icon: 'none' })
      return
    }
    const dayPlans: TravelDayPlan[] = Array.from({ length: days }, (_, index) => ({
      day: index + 1,
      poiIds: ids.filter((_, poiIndex) => poiIndex % days === index),
    }))
    this.setData({ days, dayPlans })
    this.refreshViews()
  },

  async onSave() {
    if (this.data.saving) return
    const title = this.data.title.trim()
    const city = this.data.city.trim()
    if (!title || !city) {
      wx.showToast({ title: '请填写标题和城市', icon: 'none' })
      return
    }
    if (!this.data.selectedIds.length) {
      wx.showToast({ title: '请先选择想去地点', icon: 'none' })
      return
    }
    const selected = new Set(this.data.selectedIds)
    const dayPlans = this.data.dayPlans.length
      ? this.data.dayPlans.map((day) => ({ ...day, poiIds: day.poiIds.filter((id) => selected.has(id)) }))
      : Array.from({ length: this.data.days }, (_, index) => ({
          day: index + 1,
          poiIds: this.data.selectedIds.filter((_, poiIndex) => poiIndex % this.data.days === index),
        }))
    const draft: TravelPlanDraft = {
      id: this.data.id || undefined,
      title,
      city,
      days: this.data.days,
      preferences: splitPreferences(this.data.preferencesInput),
      poiIds: this.data.selectedIds,
      dayPlans,
      status: this.data.status,
    }
    this.setData({ saving: true })
    try {
      await saveTravelPlan(draft)
      wx.showToast({ title: '计划已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 450)
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '保存失败', icon: 'none' })
      this.setData({ saving: false })
    }
  },

  onDelete() {
    if (!this.data.id) return
    wx.showModal({
      title: '删除计划',
      content: '仅删除这份计划，想去地点仍会保留。',
      confirmText: '删除',
      confirmColor: '#C0524A',
      success: async (result) => {
        if (!result.confirm) return
        try {
          await deleteTravelPlan(this.data.id)
          wx.navigateBack()
        } catch {
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      },
    })
  },
})
