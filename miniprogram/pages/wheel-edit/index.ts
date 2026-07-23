import { BRANDS } from '../../data/catalog'
import type { Wheel, WheelItem } from '../../domain/types'
import {
  copyWheel,
  deleteWheel,
  listWheels,
  saveWheel,
} from '../../services/repository'
import { createId } from '../../utils/id'
import { brandToWheelItem, validateWheelItems } from '../../utils/wheel'

Page({
  data: {
    wheel: null as Wheel | null,
    customLabel: '',
    catalogLabels: BRANDS.map((brand) => brand.name),
    catalogIndex: 0,
    validationMessage: '',
  },
  async onLoad(query: Record<string, string>) {
    const wheels = await listWheels()
    const wheel = wheels.find((item) => item.id === query.id)
    if (!wheel) {
      wx.showToast({ title: '转盘不存在', icon: 'none' })
      wx.navigateBack()
      return
    }
    this.setData({ wheel: { ...wheel, items: wheel.items.map((item) => ({ ...item })) } })
  },
  updateName(event: WechatMiniprogram.Input) {
    if (!this.data.wheel) return
    this.setData({ 'wheel.name': event.detail.value })
  },
  updateCustomLabel(event: WechatMiniprogram.Input) {
    this.setData({ customLabel: event.detail.value })
  },
  addCustom() {
    const label = this.data.customLabel.trim()
    if (!label || !this.data.wheel) {
      wx.showToast({ title: '先输入候选名称', icon: 'none' })
      return
    }
    const item: WheelItem = { id: createId('item'), label, brandName: label }
    this.setData({
      'wheel.items': [...this.data.wheel.items, item],
      customLabel: '',
      validationMessage: '',
    })
  },
  changeCatalog(event: WechatMiniprogram.PickerChange) {
    this.setData({ catalogIndex: Number(event.detail.value) })
  },
  addCatalogItem() {
    if (!this.data.wheel) return
    const brand = BRANDS[this.data.catalogIndex]
    if (!brand) return
    const exists = this.data.wheel.items.some(
      (item) => item.brandId === brand.id || item.brandName === brand.name,
    )
    if (exists) {
      wx.showToast({ title: '这个品牌已经添加', icon: 'none' })
      return
    }
    const item = brandToWheelItem(brand, createId('item'))
    this.setData({ 'wheel.items': [...this.data.wheel.items, item], validationMessage: '' })
  },
  removeItem(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.wheel) return
    const id = String(event.currentTarget.dataset.id)
    this.setData({ 'wheel.items': this.data.wheel.items.filter((item) => item.id !== id) })
  },
  async save() {
    if (!this.data.wheel) return
    const name = this.data.wheel.name.trim()
    if (!name) {
      wx.showToast({ title: '请填写转盘名称', icon: 'none' })
      return
    }
    const error = validateWheelItems(this.data.wheel.items)
    if (error) {
      this.setData({ validationMessage: error })
      wx.showToast({ title: error, icon: 'none' })
      return
    }
    await saveWheel({ ...this.data.wheel, name })
    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 500)
  },
  async copy() {
    if (!this.data.wheel) return
    await copyWheel(this.data.wheel)
    wx.showToast({ title: '已复制', icon: 'success' })
  },
  remove() {
    if (!this.data.wheel) return
    wx.showModal({
      title: '删除这个转盘？',
      content: '删除后无法恢复，至少会保留一个默认转盘。',
      confirmText: '删除',
      confirmColor: '#A54B3F',
      success: async (result) => {
        if (!result.confirm || !this.data.wheel) return
        await deleteWheel(this.data.wheel.id)
        wx.navigateBack()
      },
    })
  },
})
