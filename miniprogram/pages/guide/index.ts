import type { Footprint, TravelPlan } from '../../domain/types'
import { listFootprints, listTravelPlans } from '../../services/repository'
import { sortByCreatedDesc } from '../../utils/footprint'

interface PageData {
  wishlist: Footprint[]
  fulfilledWishes: Footprint[]
  travelPlans: TravelPlan[]
  loading: boolean
  wishlistEmpty: boolean
  plansEmpty: boolean
}

const app = getApp<IAppOption>()
const MAP_MODE_STORAGE_KEY = 'sgj:map-mode'

Page<PageData, WechatMiniprogram.IAnyObject>({
  data: {
    wishlist: [],
    fulfilledWishes: [],
    travelPlans: [],
    loading: true,
    wishlistEmpty: false,
    plansEmpty: false,
  },

  onShow() {
    this.loadAll()
  },

  async loadAll() {
    this.setData({ loading: true })
    const cachedAt = app.globalData.footprintsCachedAt || 0
    let footprints = app.globalData.footprints || []
    if (!footprints.length || Date.now() - cachedAt > 60_000) {
      try {
        footprints = await listFootprints()
        app.globalData.footprints = footprints
        app.globalData.footprintsCachedAt = Date.now()
      } catch (err) {
        console.warn('[guide] load footprints failed', err)
      }
    }
    let travelPlans: TravelPlan[] = []
    try {
      travelPlans = await listTravelPlans()
    } catch (err) {
      console.warn('[guide] load travel plans failed', err)
    }
    const wishlist = sortByCreatedDesc(
      footprints.filter((fp) => fp.status === 'wishlist'),
    )
    const fulfilledWishes = sortByCreatedDesc(footprints.filter((fp) => fp.status === 'fulfilled'))
    this.setData({
      wishlist,
      fulfilledWishes,
      travelPlans: [...travelPlans].sort((a, b) => b.updatedAt - a.updatedAt),
      loading: false,
      wishlistEmpty: wishlist.length === 0,
      plansEmpty: travelPlans.length === 0,
    })
  },

  onConvertVisited(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    wx.navigateTo({ url: `/pages/footprint-form/index?id=${id}&convert=1` })
  },

  onWishlistTap(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const id = e.detail.id
    if (!id) return
    wx.navigateTo({ url: `/pages/footprint-detail/index?id=${id}` })
  },

  onAddWishlist() {
    wx.setStorageSync(MAP_MODE_STORAGE_KEY, 'wishlist')
    wx.switchTab({ url: '/pages/map/index' })
  },

  onGeneratePlan() {
    wx.navigateTo({ url: '/pages/travel-plan/index' })
  },

  onTravelPlanTap(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    wx.navigateTo({ url: `/pages/travel-plan/index?id=${id}` })
  },
})
