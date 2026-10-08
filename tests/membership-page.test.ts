import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const repository = vi.hoisted(() => ({
  createPaymentOrder: vi.fn(),
  getMembershipAccount: vi.fn(),
  getPaymentOrder: vi.fn(),
  saveReminderSubscription: vi.fn(),
}))
const productEvents = vi.hoisted(() => ({ trackProductEvent: vi.fn() }))

vi.mock('../miniprogram/services/repository', () => repository)
vi.mock('../miniprogram/services/product-events', () => productEvents)

let definition: Record<string, any>
let page: Record<string, any>

const account = (growth: Record<string, unknown> = {}, orders: Array<Record<string, unknown>> = []) => ({
  profile: { id: 'member-test', nickname: '', avatarUrl: '', growth, createdAt: 1, updatedAt: 1 },
  orders,
  reminderTemplateId: '',
  reminderAuthorizations: 0,
})

beforeAll(async () => {
  ;(globalThis as any).Page = (value: Record<string, any>) => { definition = value }
  ;(globalThis as any).wx = {
    canIUse: vi.fn(() => true),
    getDeviceInfo: vi.fn(() => ({ platform: 'android' })),
    getAppBaseInfo: vi.fn(() => ({ version: '8.0.68' })),
    showModal: vi.fn(),
    showToast: vi.fn(),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    requestVirtualPayment: vi.fn(),
    requestSubscribeMessage: vi.fn(),
    navigateTo: vi.fn(),
    pageScrollTo: vi.fn(),
  }
  await import('../miniprogram/pages/membership/index')
})

beforeEach(() => {
  page = {
    ...definition,
    selectionInitialized: false,
    data: structuredClone(definition.data),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch) },
  }
  repository.getMembershipAccount.mockReset().mockResolvedValue(account())
  repository.createPaymentOrder.mockReset()
  repository.getPaymentOrder.mockReset()
  repository.saveReminderSubscription.mockReset()
  productEvents.trackProductEvent.mockReset()
  vi.mocked(wx.showModal).mockReset()
  vi.mocked(wx.showToast).mockReset()
  vi.mocked(wx.requestVirtualPayment).mockReset()
  vi.mocked(wx.navigateTo).mockReset()
  vi.mocked(wx.pageScrollTo).mockReset()
})

describe('membership page interactions', () => {
  it('switches tier first, then lets Plus users choose either duration with the exact CTA', () => {
    page.onTierTap({ currentTarget: { dataset: { tier: 'pro' } } })
    expect(page.data.selectedTier).toBe('pro')
    expect(page.data.selectedProductId).toBe('pro_372d_v1')
    expect(page.data.selectedBuyLabel).toBe('¥99 开通 Pro 年卡')

    page.onTierTap({ currentTarget: { dataset: { tier: 'plus' } } })
    page.onProductTap({ currentTarget: { dataset: { id: 'plus_31d_v1' } } })
    expect(page.data.selectedTier).toBe('plus')
    expect(page.data.selectedBuyLabel).toBe('¥6 开通 Plus 31 天')
    expect(productEvents.trackProductEvent).toHaveBeenCalledWith('membership_pro_selected')
    expect(productEvents.trackProductEvent).toHaveBeenCalledWith('membership_plus_selected')
  })

  it('expands benefit details and records the first detail view', () => {
    page.onToggleBenefits()
    expect(page.data.benefitsExpanded).toBe(true)
    expect(productEvents.trackProductEvent).toHaveBeenCalledWith('membership_benefits_viewed')
    page.onToggleBenefits()
    expect(page.data.benefitsExpanded).toBe(false)
  })

  it('distinguishes active Plus from an expired paid membership in the page state', async () => {
    const now = Date.now()
    repository.getMembershipAccount.mockResolvedValueOnce(account({ plusUntil: now + 31 * 86_400_000 }))
    await page.loadAccount()
    expect(page.data.membershipLevel.level).toBe('plus')
    expect(page.data.currentLevelIndex).toBe(1)
    expect(page.data.hasExpiredMembership).toBe(false)
    expect(page.data.selectedBuyLabel).toBe('¥49 续购 Plus 372 天')

    repository.getMembershipAccount.mockResolvedValueOnce(account(
      { plusUntil: now - 1 },
      [{
        outTradeNo: 'expired-order', productId: 'plus_31d_v1', productName: 'Plus 31 天',
        amountFen: 600, status: 'fulfilled', createdAt: now - 40 * 86_400_000,
      }],
    ))
    await page.loadAccount()
    expect(page.data.membershipLevel.level).toBe('free')
    expect(page.data.hasExpiredMembership).toBe(true)
    expect(page.data.hasExpiredTrial).toBe(false)
  })

  it('recognizes an expired paid member even when the recent order preview is empty', async () => {
    repository.getMembershipAccount.mockResolvedValueOnce({
      ...account({ plusUntil: Date.now() - 1 }),
      hasFulfilledOrder: true,
    })
    await page.loadAccount()
    expect(page.data.hasExpiredMembership).toBe(true)
    expect(page.data.hasExpiredTrial).toBe(false)
  })

  it('opens the paginated order history from the recent purchase section', () => {
    page.onOrdersTap()
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/payment-orders/index' })
  })

  it('keeps the membership page preview to the three most recent orders', async () => {
    const now = Date.now()
    repository.getMembershipAccount.mockResolvedValueOnce(account({}, Array.from({ length: 8 }, (_, index) => ({
      id: `id-${index}`,
      outTradeNo: `order-${index}`,
      productId: 'plus_31d_v1',
      productName: 'Plus 31 天',
      amountFen: 600,
      status: 'pending',
      createdAt: now - index,
      updatedAt: now - index,
    }))))
    await page.loadAccount()
    expect(page.data.orders).toHaveLength(3)
    expect(page.data.orders.map((item: any) => item.outTradeNo)).toEqual(['order-0', 'order-1', 'order-2'])
  })

  it('previews Pro benefits and carries the selection into the purchase section', () => {
    page.data.currentLevelIndex = 1
    page.data.membershipLevel = { ...page.data.membershipLevel, level: 'plus' }
    page.onLevelPreviewTap({ currentTarget: { dataset: { index: 2 } } })
    expect(page.data.previewLevelTitle).toBe('Pro')
    expect(page.data.previewLevelBenefits.map((item: any) => item.name)).toContain('年度时光回顾')
    expect(page.data.previewCanUpgrade).toBe(true)

    page.onPreviewPlanTap()
    expect(page.data.selectedTier).toBe('pro')
    expect(page.data.selectedProductId).toBe('pro_372d_v1')
    expect(wx.pageScrollTo).toHaveBeenCalledWith({ selector: '#plan-section', duration: 320 })
  })

  it('labels trial conversion as opening Plus and defaults active Pro members to Pro renewal', async () => {
    const now = Date.now()
    repository.getMembershipAccount.mockResolvedValueOnce(account({
      trialStartedAt: now,
      plusUntil: now + 7 * 86_400_000,
    }))
    await page.loadAccount()
    expect(page.data.membershipLevel.level).toBe('trial')
    expect(page.data.selectedBuyLabel).toBe('¥49 开通 Plus 372 天')

    page.selectionInitialized = false
    repository.getMembershipAccount.mockResolvedValueOnce(account({
      plusUntil: now + 372 * 86_400_000,
      proUntil: now + 372 * 86_400_000,
    }))
    await page.loadAccount()
    expect(page.data.selectedTier).toBe('pro')
    expect(page.data.selectedProductId).toBe('pro_372d_v1')
    expect(page.data.selectedBuyLabel).toBe('¥99 续购 Pro 年卡')
  })

  it('creates the selected order, waits for fulfillment, and refreshes entitlement state', async () => {
    repository.createPaymentOrder.mockResolvedValueOnce({
      order: { outTradeNo: 'paid-order' },
      payData: { mode: 'short_series_goods', paySig: 'sig', signature: 'signature', signData: '{}' },
    })
    repository.getPaymentOrder.mockResolvedValueOnce({ status: 'fulfilled' })
    vi.mocked(wx.requestVirtualPayment).mockImplementation(({ success }: any) => success())

    await page.onBuy()

    expect(repository.createPaymentOrder).toHaveBeenCalledWith('plus_372d_v1')
    expect(repository.getPaymentOrder).toHaveBeenCalledWith('paid-order')
    expect(repository.getMembershipAccount).toHaveBeenCalledOnce()
    expect(productEvents.trackProductEvent).toHaveBeenCalledWith('membership_purchase_started')
    expect(productEvents.trackProductEvent).toHaveBeenCalledWith('membership_entitlement_activated')
    expect(wx.showToast).toHaveBeenCalledWith({ title: 'Plus 会员已生效', icon: 'success' })
    expect(page.data.purchasing).toBe(false)
  })
})
