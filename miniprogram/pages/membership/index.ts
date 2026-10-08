import type {
  MembershipBenefit,
  MembershipAccount,
  MembershipLevelView,
  MembershipTier,
  PaymentOrder,
  PaymentProduct,
  PaymentProductId,
  UserProfile,
  VirtualPaymentData,
} from '../../domain/types'
import { MEMBERSHIP_REMIND_DAYS } from '../../services/config'
import { trackProductEvent } from '../../services/product-events'
import { installUpdatePerformanceLogger, startPerformanceSpan } from '../../utils/performance'
import {
  createPaymentOrder,
  getCachedMembershipAccount,
  getMembershipAccount,
  getPaymentOrder,
  saveReminderSubscription,
} from '../../services/repository'
import {
  PAYMENT_PRODUCTS,
  MEMBERSHIP_BENEFITS,
  formatPrice,
  getMembershipLevelView,
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

interface PreviewBenefit {
  icon: string
  name: string
  description: string
}

interface PageData {
  profile: UserProfile | null
  memberNumber: string
  plusProducts: ProductView[]
  proProduct: ProductView
  benefits: readonly MembershipBenefit[]
  benefitsExpanded: boolean
  selectedTier: MembershipTier
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
  selectedBuyLabel: string
  membershipLevel: MembershipLevelView
  currentLevelIndex: number
  levelSteps: Array<{ key: string; name: string; index: number }>
  previewLevelIndex: number
  previewLevelTitle: string
  previewLevelCaption: string
  previewLevelBenefits: PreviewBenefit[]
  previewActionLabel: string
  previewCanUpgrade: boolean
  isTrial: boolean
  activeExpiryLabel: string
  membershipExpiring: boolean
  hasExpiredMembership: boolean
  hasExpiredTrial: boolean
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

const plusProducts = productViews.filter((product) => product.tier === 'plus')
const proProduct = productViews.find((product) => product.tier === 'pro') as ProductView

const buyLabel = (product: ProductView, level: MembershipLevelView['level']): string => {
  const renewing = product.tier === 'pro'
    ? level === 'pro'
    : level === 'plus' || level === 'pro'
  return `¥${product.priceLabel} ${renewing ? '续购' : '开通'} ${product.name}`
}

const LEVEL_PREVIEWS = [
  {
    title: '免费版',
    caption: '记录旅程的基础能力',
    benefits: [
      { icon: 'map', name: '足迹地图', description: '记录去过与想去' },
      { icon: 'calendar', name: '本月回顾', description: '查看本月足迹变化' },
      { icon: 'clock-brand', name: '时光胶囊', description: '最多创建 3 个' },
      { icon: 'download', name: '基础导出', description: '足迹和照片可导出' },
    ],
  },
  {
    title: 'Plus',
    caption: '适合持续记录与回看',
    benefits: [
      { icon: 'calendar', name: '历史月份回顾', description: '查看过往月份' },
      { icon: 'unlock', name: '不限时光胶囊', description: '创建数量不受限制' },
      { icon: 'sparkles', name: 'Lumi 专属主题', description: '使用会员专属主题' },
      { icon: 'map', name: '包含免费版', description: '基础记录能力持续可用' },
    ],
  },
  {
    title: 'Pro',
    caption: '为长期旅行记录生成年度总结',
    benefits: [
      { icon: 'sparkles', name: '年度时光回顾', description: '年度统计与规则化故事' },
      { icon: 'route', name: '跨年对比', description: '连续两年有记录时展示' },
      { icon: 'secured', name: '全部 Plus 权益', description: '包含 Plus 全部能力' },
    ],
  },
] as const

const levelPreviewData = (previewIndex: number, currentIndex: number) => {
  const preview = LEVEL_PREVIEWS[previewIndex] || LEVEL_PREVIEWS[0]
  const previewCanUpgrade = previewIndex > currentIndex
  return {
    previewLevelIndex: previewIndex,
    previewLevelTitle: preview.title,
    previewLevelCaption: preview.caption,
    previewLevelBenefits: [...preview.benefits],
    previewCanUpgrade,
    previewActionLabel: previewCanUpgrade
      ? `查看 ${preview.title} 购买方案`
      : previewIndex === currentIndex
        ? '当前正在使用'
        : '当前会员已包含',
  }
}

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
  selectionInitialized: false,
  data: {
    profile: null,
    memberNumber: 'MEMBER',
    plusProducts,
    proProduct,
    benefits: MEMBERSHIP_BENEFITS,
    benefitsExpanded: false,
    selectedTier: 'plus',
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
    selectedBuyLabel: buyLabel(plusProducts[1], 'free'),
    membershipLevel: getMembershipLevelView(),
    currentLevelIndex: 0,
    levelSteps: [
      { key: 'free', name: '免费版', index: 0 },
      { key: 'plus', name: 'Plus', index: 1 },
      { key: 'pro', name: 'Pro', index: 2 },
    ],
    ...levelPreviewData(0, 0),
    isTrial: false,
    activeExpiryLabel: '',
    membershipExpiring: false,
    hasExpiredMembership: false,
    hasExpiredTrial: false,
    reminderTemplateId: '',
    reminderAvailable: false,
    reminderEnabled: false,
    reminderBusy: false,
    remindDaysLabel: String(MEMBERSHIP_REMIND_DAYS),
  },

  onLoad() {
    installUpdatePerformanceLogger(this, 'membership')
    trackProductEvent('membership_page_viewed')
    // 先用本地会员快照完成首屏，云端账户在后台校准购买记录和提醒状态。
    this.applyAccount(getCachedMembershipAccount(), false)
    this.loadAccount()
  },

  applyAccount(account: MembershipAccount, settled = true) {
    const growth = account.profile.growth
    const plusUntil = growth?.plusUntil
    const proUntil = growth?.proUntil
    const isPlus = isGrowthPlusActive(growth)
    const isPro = isGrowthProActive(growth)
    const membershipLevel = getMembershipLevelView(growth)
    const selectedProduct = !this.selectionInitialized && membershipLevel.level === 'pro'
      ? proProduct
      : productViews.find((item) => item.id === this.data.selectedProductId) || plusProducts[1]
    this.selectionInitialized = true
    const accountOrders: OrderView[] = account.orders.map((order) => ({
      ...order,
      priceLabel: formatPrice(order.amountFen),
      statusLabel: STATUS_LABELS[order.status],
      dateLabel: formatDate(order.fulfilledAt || order.createdAt),
    }))
    const orders = accountOrders.slice(0, 3)
    const hasFulfilledOrder = account.hasFulfilledOrder
      ?? accountOrders.some((order) => order.status === 'fulfilled')
    const plusDaysLeft = membershipDaysLeft(plusUntil)
    const proDaysLeft = membershipDaysLeft(proUntil)
    const membershipExpiring = isPlus
      && membershipLevel.level !== 'trial'
      && isMembershipExpiringSoon(isPro ? proUntil : plusUntil)
    const activeExpiryLabel = !isPlus
      ? ''
      : isPro
        ? `剩余 ${proDaysLeft} 天 · ${formatDate(proUntil)} 到期${membershipExpiring ? '，即将到期' : ''}`
        : `剩余 ${plusDaysLeft} 天 · ${formatDate(plusUntil)} 到期${membershipExpiring ? '，即将到期' : ''}`
    const currentLevelIndex = membershipLevel.level === 'pro' ? 2 : membershipLevel.level === 'free' ? 0 : 1
    this.setData({
      profile: account.profile,
      memberNumber: String(account.profile.id || 'MEMBER').slice(-6).toUpperCase(),
      orders,
      isPlus,
      isPro,
      membershipLevel,
      selectedTier: selectedProduct.tier,
      selectedProductId: selectedProduct.id,
      selectedIsPro: selectedProduct.tier === 'pro',
      selectedProductName: selectedProduct.name,
      currentLevelIndex,
      ...levelPreviewData(currentLevelIndex, currentLevelIndex),
      isTrial: membershipLevel.level === 'trial',
      plusUntilLabel: plusUntil ? formatDate(plusUntil) : '',
      proUntilLabel: proUntil ? formatDate(proUntil) : '',
      activeExpiryLabel,
      membershipExpiring,
      hasExpiredMembership: !isPlus && hasFulfilledOrder,
      hasExpiredTrial: !isPlus
        && Boolean(growth?.trialStartedAt)
        && !hasFulfilledOrder,
      reminderTemplateId: account.reminderTemplateId || '',
      reminderAvailable: Boolean(account.reminderTemplateId),
      reminderEnabled: (account.reminderAuthorizations || 0) > 0,
      selectedBuyLabel: buyLabel(selectedProduct, membershipLevel.level),
      ...(settled ? { loading: false, loadFailed: false, refreshing: false } : {}),
    })
  },

  async loadAccount(showResult = false, reconcilePending = false) {
    const end = startPerformanceSpan('membership.loadAccount')
    try {
      const account = await getMembershipAccount({ reconcilePending })
      this.applyAccount(account)
      end({ orders: account.orders.length })
      if (showResult) wx.showToast({ title: '权益已刷新', icon: 'success' })
    } catch (error) {
      end({ failed: 1 })
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
      const product = productViews.find((item) => item.id === productId)
      this.setData({
        selectedProductId: productId,
        selectedTier: product?.tier || 'plus',
        selectedIsPro: product?.tier === 'pro',
        selectedProductName: product?.name || 'Plus',
        selectedBuyLabel: buyLabel(product || plusProducts[1], this.data.membershipLevel.level),
      })
    }
  },

  onTierTap(event: WechatMiniprogram.TouchEvent) {
    const tier = String(event.currentTarget.dataset.tier || '') as MembershipTier
    if (tier !== 'plus' && tier !== 'pro') return
    const product = tier === 'pro'
      ? proProduct
      : plusProducts.find((item) => item.id === this.data.selectedProductId) || plusProducts[1]
    trackProductEvent(tier === 'pro' ? 'membership_pro_selected' : 'membership_plus_selected')
    this.setData({
      selectedTier: tier,
      selectedProductId: product.id,
      selectedIsPro: tier === 'pro',
      selectedProductName: product.name,
      selectedBuyLabel: buyLabel(product, this.data.membershipLevel.level),
    })
  },

  onLevelPreviewTap(event: WechatMiniprogram.TouchEvent) {
    const previewIndex = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(previewIndex) || previewIndex < 0 || previewIndex > 2) return
    this.setData(levelPreviewData(previewIndex, this.data.currentLevelIndex))
  },

  onPreviewPlanTap() {
    const previewIndex = this.data.previewLevelIndex
    if (!this.data.previewCanUpgrade || previewIndex === 0) return
    const tier: MembershipTier = previewIndex === 2 ? 'pro' : 'plus'
    const product = tier === 'pro' ? proProduct : plusProducts[1]
    trackProductEvent(tier === 'pro' ? 'membership_pro_selected' : 'membership_plus_selected')
    this.setData({
      selectedTier: tier,
      selectedProductId: product.id,
      selectedIsPro: tier === 'pro',
      selectedProductName: product.name,
      selectedBuyLabel: buyLabel(product, this.data.membershipLevel.level),
    })
    wx.pageScrollTo({ selector: '#plan-section', duration: 320 })
  },

  onToggleBenefits() {
    const expanded = !this.data.benefitsExpanded
    if (expanded) trackProductEvent('membership_benefits_viewed')
    this.setData({ benefitsExpanded: expanded })
  },

  async onBuy() {
    if (this.data.purchasing || !supportsPayment()) return
    const product = productViews.find((item) => item.id === this.data.selectedProductId)
    if (!product) return
    trackProductEvent('membership_purchase_started')
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
        trackProductEvent('membership_entitlement_activated')
        wx.showToast({ title: product.tier === 'pro' ? 'Pro 会员已生效' : 'Plus 会员已生效', icon: 'success' })
      } else {
        wx.showModal({
          title: '支付结果确认中',
          content: '平台正在确认订单，权益通常会在几秒内到账。你可以稍后点击“同步支付结果”刷新。',
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

  onSyncPaymentStatus() {
    if (this.data.refreshing) return
    this.setData({ refreshing: true })
    this.loadAccount(true, true)
  },

  onOrdersTap() {
    wx.navigateTo({ url: '/pages/payment-orders/index' })
  },
})
