import type { PaymentOrder } from '../../domain/types'
import {
  getMembershipAccount,
  hidePaymentOrder,
  listPaymentOrders,
} from '../../services/repository'
import { formatPrice } from '../../utils/payment'

interface OrderView extends PaymentOrder {
  priceLabel: string
  statusLabel: string
  dateLabel: string
}

interface PageData {
  orders: OrderView[]
  total: number
  nextOffset: number
  hasMore: boolean
  loading: boolean
  loadingMore: boolean
  syncing: boolean
  loadFailed: boolean
  revealedOrderNo: string
}

const PAGE_SIZE = 10
const STATUS_LABELS: Record<PaymentOrder['status'], string> = {
  pending: '待确认',
  paid: '已支付',
  fulfilled: '已生效',
  refunded: '已退款',
  failed: '支付失败',
}

const formatDate = (time?: number): string => {
  if (!time) return ''
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const toOrderView = (order: PaymentOrder): OrderView => ({
  ...order,
  priceLabel: formatPrice(order.amountFen),
  statusLabel: STATUS_LABELS[order.status],
  dateLabel: formatDate(order.fulfilledAt || order.createdAt),
})

const confirmHide = (): Promise<boolean> => new Promise((resolve) => {
  wx.showModal({
    title: '隐藏这条购买记录？',
    content: '仅从列表中隐藏，不会删除支付订单。订单仍用于支付查询、退款处理和权益核对。',
    confirmText: '隐藏',
    confirmColor: '#C94C5B',
    success: (result) => resolve(result.confirm),
    fail: () => resolve(false),
  })
})

Page<PageData, WechatMiniprogram.IAnyObject>({
  touchStartX: 0,
  touchStartY: 0,
  data: {
    orders: [],
    total: 0,
    nextOffset: 0,
    hasMore: false,
    loading: true,
    loadingMore: false,
    syncing: false,
    loadFailed: false,
    revealedOrderNo: '',
  },

  onLoad() {
    this.loadOrders(true)
  },

  onReachBottom() {
    // A failed cloud page should wait for an explicit retry instead of
    // repeatedly requesting the same offset on every bottom bounce.
    if (!this.data.loadFailed) this.loadMore()
  },

  onPullDownRefresh() {
    this.loadOrders(true).finally(() => wx.stopPullDownRefresh())
  },

  async loadOrders(reset = false) {
    if (reset) {
      this.setData({ loading: true, loadFailed: false, revealedOrderNo: '' })
    }
    try {
      const offset = reset ? 0 : this.data.nextOffset
      const result = await listPaymentOrders(offset, PAGE_SIZE)
      const nextOrders = result.orders.map(toOrderView)
      this.setData({
        orders: reset ? nextOrders : [...this.data.orders, ...nextOrders],
        total: result.total,
        nextOffset: result.nextOffset,
        hasMore: result.hasMore,
        loading: false,
        loadingMore: false,
        loadFailed: false,
      })
      return true
    } catch (error) {
      console.warn('[payment-orders] load failed', error)
      this.setData({ loading: false, loadingMore: false, loadFailed: true })
      return false
    }
  },

  onRetryLoad() {
    this.loadOrders(true)
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loading || this.data.loadingMore) return
    this.setData({ loadingMore: true, revealedOrderNo: '' })
    this.loadOrders(false)
  },

  onOrderTouchStart(event: WechatMiniprogram.TouchEvent) {
    this.touchStartX = event.touches[0]?.clientX || 0
    this.touchStartY = event.touches[0]?.clientY || 0
  },

  onOrderTouchEnd(event: WechatMiniprogram.TouchEvent) {
    const outTradeNo = String(event.currentTarget.dataset.no || '')
    const endX = event.changedTouches[0]?.clientX || this.touchStartX
    const endY = event.changedTouches[0]?.clientY || this.touchStartY
    const distance = endX - this.touchStartX
    if (Math.abs(endY - this.touchStartY) > Math.abs(distance)) return
    if (distance < -42) this.setData({ revealedOrderNo: outTradeNo })
    if (distance > 32) this.setData({ revealedOrderNo: '' })
  },

  onOrderTap() {
    if (this.data.revealedOrderNo) this.setData({ revealedOrderNo: '' })
  },

  async onHideOrder(event: WechatMiniprogram.TouchEvent) {
    const outTradeNo = String(event.currentTarget.dataset.no || '')
    if (!outTradeNo || !(await confirmHide())) return
    wx.showLoading({ title: '正在隐藏…', mask: true })
    try {
      await hidePaymentOrder(outTradeNo)
      const orders = this.data.orders.filter((order) => order.outTradeNo !== outTradeNo)
      this.setData({
        orders,
        total: Math.max(0, this.data.total - 1),
        nextOffset: Math.max(0, this.data.nextOffset - 1),
        revealedOrderNo: '',
      })
      wx.showToast({ title: '已从列表隐藏', icon: 'none' })
      if (this.data.hasMore && orders.length < PAGE_SIZE) this.loadMore()
    } catch (error) {
      console.warn('[payment-orders] hide failed', error)
      wx.showToast({ title: '隐藏失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async onSyncPaymentStatus() {
    if (this.data.syncing) return
    this.setData({ syncing: true })
    try {
      await getMembershipAccount()
      const loaded = await this.loadOrders(true)
      if (!loaded) {
        wx.showToast({ title: '同步失败，请重试', icon: 'none' })
        return
      }
      wx.showToast({ title: '支付状态已同步', icon: 'success' })
    } catch (error) {
      console.warn('[payment-orders] sync failed', error)
      wx.showToast({ title: '同步失败，请重试', icon: 'none' })
    } finally {
      this.setData({ syncing: false })
    }
  },
})
