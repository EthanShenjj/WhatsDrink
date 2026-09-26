import type {
  PaymentOrder,
  PaymentProduct,
  PaymentProductId,
  UserProfile,
  VirtualPaymentData,
} from '../../domain/types'
import {
  createPaymentOrder,
  getMembershipAccount,
  getPaymentOrder,
} from '../../services/repository'
import { PAYMENT_PRODUCTS, formatPrice } from '../../utils/payment'
import { isGrowthPlusActive } from '../../utils/growth'

interface ProductView extends PaymentProduct {
  priceLabel: string
  perMonthLabel: string
}

interface OrderView extends PaymentOrder {
  priceLabel: string
  statusLabel: string
  dateLabel: string
}

interface PageData {
  profile: UserProfile | null
  products: ProductView[]
  selectedProductId: PaymentProductId
  orders: OrderView[]
  loading: boolean
  purchasing: boolean
  refreshing: boolean
  isPlus: boolean
  plusUntilLabel: string
}

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

const productViews: ProductView[] = PAYMENT_PRODUCTS.map((product) => ({
  ...product,
  priceLabel: formatPrice(product.priceFen),
  perMonthLabel: product.days > 100
    ? `约 ¥${(product.priceFen / 100 / 12).toFixed(1)}/月`
    : '一次购买，31 天有效',
}))

const requestVirtualPayment = (payData: VirtualPaymentData): Promise<void> =>
  new Promise((resolve, reject) => {
    wx.requestVirtualPayment({
      mode: payData.mode,
      paySig: payData.paySig,
      signature: payData.signature,
      // The runtime API requires the exact signed JSON string; the current typings
      // incorrectly model this documented string field as an object.
      signData: payData.signData as unknown as WechatMiniprogram.SignData,
      success: () => resolve(),
      fail: reject,
    })
  })

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const supportsPayment = (): boolean => {
  if (!wx.canIUse('requestVirtualPayment')) {
    wx.showModal({
      title: '微信版本较旧',
      content: '请将微信更新至最新版后再购买拾光+。',
      showCancel: false,
    })
    return false
  }
  const system = wx.getSystemInfoSync()
  if (system.platform !== 'ios') return true
  const current = String(system.version || '').split('.').map(Number)
  const minimum = [8, 0, 68]
  for (let index = 0; index < minimum.length; index += 1) {
    if ((current[index] || 0) > minimum[index]) return true
    if ((current[index] || 0) < minimum[index]) {
      wx.showModal({
        title: '微信版本较旧',
        content: 'iPhone 需使用微信 8.0.68 或以上版本才能购买。',
        showCancel: false,
      })
      return false
    }
  }
  return true
}

Page<PageData, WechatMiniprogram.IAnyObject>({
  data: {
    profile: null,
    products: productViews,
    selectedProductId: 'plus_372d_v1',
    orders: [],
    loading: true,
    purchasing: false,
    refreshing: false,
    isPlus: false,
    plusUntilLabel: '',
  },

  onLoad() {
    this.loadAccount()
  },

  async loadAccount(showResult = false) {
    try {
      const account = await getMembershipAccount()
      const plusUntil = account.profile.growth?.plusUntil
      const orders: OrderView[] = account.orders.map((order) => ({
        ...order,
        priceLabel: formatPrice(order.amountFen),
        statusLabel: STATUS_LABELS[order.status],
        dateLabel: formatDate(order.fulfilledAt || order.createdAt),
      }))
      this.setData({
        profile: account.profile,
        orders,
        isPlus: isGrowthPlusActive(account.profile.growth),
        plusUntilLabel: plusUntil ? formatDate(plusUntil) : '',
        loading: false,
        refreshing: false,
      })
      if (showResult) wx.showToast({ title: '权益已刷新', icon: 'success' })
    } catch (error) {
      console.warn('[membership] load failed', error)
      this.setData({ loading: false, refreshing: false })
      if (showResult) wx.showToast({ title: '刷新失败，请重试', icon: 'none' })
    }
  },

  onProductTap(event: WechatMiniprogram.TouchEvent) {
    const productId = String(event.currentTarget.dataset.id || '') as PaymentProductId
    if (PAYMENT_PRODUCTS.some((product) => product.id === productId)) {
      this.setData({ selectedProductId: productId })
    }
  },

  async onBuy() {
    if (this.data.purchasing || !supportsPayment()) return
    const product = PAYMENT_PRODUCTS.find((item) => item.id === this.data.selectedProductId)
    if (!product) return
    this.setData({ purchasing: true })
    wx.showLoading({ title: '正在创建订单…', mask: true })
    try {
      const { order, payData } = await createPaymentOrder(product.id)
      wx.hideLoading()
      await requestVirtualPayment(payData)
      wx.showLoading({ title: '正在确认权益…', mask: true })
      const fulfilled = await this.waitForFulfillment(order.outTradeNo)
      wx.hideLoading()
      await this.loadAccount()
      if (fulfilled) {
        wx.showToast({ title: '拾光+ 已生效', icon: 'success' })
      } else {
        wx.showModal({
          title: '支付结果确认中',
          content: '平台正在确认订单，权益通常会在几秒内到账。你可以稍后点击“恢复购买与权益”刷新。',
          showCancel: false,
        })
      }
    } catch (error) {
      wx.hideLoading()
      const paymentError = error as WechatMiniprogram.VirtualPaymentError & Error
      if (paymentError.errCode === -2 || /cancel/i.test(paymentError.errMsg || '')) {
        wx.showToast({ title: '已取消支付', icon: 'none' })
      } else {
        wx.showModal({
          title: '暂时无法购买',
          content: paymentError.message || paymentError.errMsg || '请稍后重试',
          showCancel: false,
        })
      }
    } finally {
      wx.hideLoading()
      this.setData({ purchasing: false })
    }
  },

  async waitForFulfillment(outTradeNo: string): Promise<boolean> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0) await delay(1500)
      try {
        const order = await getPaymentOrder(outTradeNo)
        if (order.status === 'fulfilled') return true
        if (order.status === 'failed' || order.status === 'refunded') return false
      } catch {
        // A transient query failure should not turn a successful payment into a failure message.
      }
    }
    return false
  },

  onRefresh() {
    if (this.data.refreshing) return
    this.setData({ refreshing: true })
    this.loadAccount(true)
  },
})
