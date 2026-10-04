import type {
  PaymentOrder,
  PaymentProduct,
  PaymentProductId,
  UserProfile,
  VirtualPaymentData,
} from '../../domain/types'
import { MEMBERSHIP_REMIND_DAYS } from '../../services/config'
import {
  createPaymentOrder,
  getMembershipAccount,
  getPaymentOrder,
  saveReminderSubscription,
} from '../../services/repository'
import {
  PAYMENT_PRODUCTS,
  formatPrice,
  isMembershipExpiringSoon,
  membershipDaysLeft,
} from '../../utils/payment'
import { isGrowthPlusActive, isGrowthProActive } from '../../utils/growth'

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
  loadFailed: boolean
  purchasing: boolean
  refreshing: boolean
  isPlus: boolean
  isPro: boolean
  plusUntilLabel: string
  proUntilLabel: string
  selectedIsPro: boolean
  selectedProductName: string
  activeExpiryLabel: string
  membershipExpiring: boolean
  hasExpiredMembership: boolean
  reminderTemplateId: string
  reminderAvailable: boolean
  reminderEnabled: boolean
  reminderBusy: boolean
  remindDaysLabel: string
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
    ? `${product.tier === 'pro' ? '含 Plus · ' : ''}一次性支付，折合约 ¥${(product.priceFen / 100 / 12).toFixed(1)}/月`
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

const paymentFailureMessage = (error: WechatMiniprogram.VirtualPaymentError & Error): string => {
  if (/PAYMENT_ILLEGAL_IN_SANDBOX/i.test(error.errMsg || error.message || '')) {
    return '当前支付环境不支持在手机上购买，请稍后再试。'
  }
  if (error.errCode === -15006 || /PAY_SIG_INVALID/i.test(error.errMsg || error.message || '')) {
    return '支付环境与密钥不匹配，请稍后再试。'
  }
  if (error.errCode === -604100) {
    return '微信支付登录服务暂时不可用，请稍后再试。'
  }
  if (error.errCode === -15008) return '微信支付签约尚未完成，请稍后再试。'
  if (error.errCode === -15010 || error.errCode === -15014 || error.errCode === -15018) {
    return '当前会员商品尚未发布生效，请稍后再试。'
  }
  if (error.errCode === -15020 || error.errCode === -15021) return '操作较频繁，请稍后再试。'
  return error.message || error.errMsg || '请稍后重试'
}

const supportsPayment = (): boolean => {
  if (!wx.canIUse('requestVirtualPayment')) {
    wx.showModal({
      title: '微信版本较旧',
      content: '请将微信更新至最新版后再购买会员方案。',
      showCancel: false,
    })
    return false
  }
  if (wx.getDeviceInfo().platform !== 'ios') return true
  const current = String(wx.getAppBaseInfo().version || '').split('.').map(Number)
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
    loadFailed: false,
    purchasing: false,
    refreshing: false,
    isPlus: false,
    isPro: false,
    plusUntilLabel: '',
    proUntilLabel: '',
    selectedIsPro: false,
    selectedProductName: 'Plus 372 天',
    activeExpiryLabel: '',
    membershipExpiring: false,
    hasExpiredMembership: false,
    reminderTemplateId: '',
    reminderAvailable: false,
    reminderEnabled: false,
    reminderBusy: false,
    remindDaysLabel: String(MEMBERSHIP_REMIND_DAYS),
  },

  onLoad() {
    this.loadAccount()
  },

  async loadAccount(showResult = false) {
    try {
      const account = await getMembershipAccount()
      const growth = account.profile.growth
      const plusUntil = growth?.plusUntil
      const proUntil = growth?.proUntil
      const isPlus = isGrowthPlusActive(growth)
      const isPro = isGrowthProActive(growth)
      const orders: OrderView[] = account.orders.map((order) => ({
        ...order,
        priceLabel: formatPrice(order.amountFen),
        statusLabel: STATUS_LABELS[order.status],
        dateLabel: formatDate(order.fulfilledAt || order.createdAt),
      }))
      const plusDaysLeft = membershipDaysLeft(plusUntil)
      const proDaysLeft = membershipDaysLeft(proUntil)
      // Pro 生效期间 plusUntil 不会早于 proUntil，展示等级对应的到期口径
      const membershipExpiring = isPlus
        && isMembershipExpiringSoon(isPro ? proUntil : plusUntil)
      const activeExpiryLabel = !isPlus
        ? ''
        : isPro
          ? `剩余 ${proDaysLeft} 天 · ${formatDate(proUntil)} 到期${membershipExpiring ? '，即将到期' : ''}`
          : `剩余 ${plusDaysLeft} 天 · ${formatDate(plusUntil)} 到期${membershipExpiring ? '，即将到期' : ''}`
      this.setData({
        profile: account.profile,
        orders,
        isPlus,
        isPro,
        plusUntilLabel: plusUntil ? formatDate(plusUntil) : '',
        proUntilLabel: proUntil ? formatDate(proUntil) : '',
        activeExpiryLabel,
        membershipExpiring,
        hasExpiredMembership: !isPlus && orders.some((order) => order.status === 'fulfilled'),
        reminderTemplateId: account.reminderTemplateId || '',
        reminderAvailable: Boolean(account.reminderTemplateId),
        reminderEnabled: (account.reminderAuthorizations || 0) > 0,
        loading: false,
        loadFailed: false,
        refreshing: false,
      })
      if (showResult) wx.showToast({ title: '权益已刷新', icon: 'success' })
    } catch (error) {
      console.warn('[membership] load failed', error)
      this.setData({ loading: false, loadFailed: true, refreshing: false })
      if (showResult) wx.showToast({ title: '刷新失败，请重试', icon: 'none' })
    }
  },

  requestReminderAuthorization(): Promise<boolean> {
    const templateId = this.data.reminderTemplateId
    if (!templateId) return Promise.resolve(false)
    return new Promise((resolve) => {
      wx.requestSubscribeMessage({
        tmplIds: [templateId],
        success: (result) => resolve(result[templateId] === 'accept'),
        fail: () => resolve(false),
      })
    })
  },

  async onReminderToggle(event: WechatMiniprogram.SwitchChange) {
    const templateId = this.data.reminderTemplateId
    if (this.data.reminderBusy || !templateId) return
    const enabled = Boolean(event.detail.value)
    this.setData({ reminderBusy: true, reminderEnabled: enabled })
    try {
      if (enabled && !(await this.requestReminderAuthorization())) {
        this.setData({ reminderEnabled: false })
        wx.showToast({ title: '未授权提醒，可随时再次开启', icon: 'none' })
        return
      }
      const result = await saveReminderSubscription(templateId, enabled)
      this.setData({ reminderEnabled: result.enabled && result.count > 0 })
      wx.showToast({
        title: enabled ? `到期前 ${MEMBERSHIP_REMIND_DAYS} 天会提醒你` : '已关闭到期提醒',
        icon: 'none',
      })
    } catch (error) {
      this.setData({ reminderEnabled: !enabled })
      console.warn('[membership] reminder toggle failed', error)
      wx.showToast({ title: '提醒设置失败，请重试', icon: 'none' })
    } finally {
      this.setData({ reminderBusy: false })
    }
  },

  onProductTap(event: WechatMiniprogram.TouchEvent) {
    const productId = String(event.currentTarget.dataset.id || '') as PaymentProductId
    if (PAYMENT_PRODUCTS.some((product) => product.id === productId)) {
      const product = PAYMENT_PRODUCTS.find((item) => item.id === productId)
      this.setData({
        selectedProductId: productId,
        selectedIsPro: product?.tier === 'pro',
        selectedProductName: product?.name || 'Plus',
      })
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
        wx.showToast({ title: product.tier === 'pro' ? 'Pro 会员已生效' : 'Plus 会员已生效', icon: 'success' })
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
          content: paymentFailureMessage(paymentError),
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
