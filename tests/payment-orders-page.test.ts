import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const repository = vi.hoisted(() => ({
  getMembershipAccount: vi.fn(),
  hidePaymentOrder: vi.fn(),
  listPaymentOrders: vi.fn(),
}))

vi.mock('../miniprogram/services/repository', () => repository)

let definition: Record<string, any>
let page: Record<string, any>

const order = (index: number) => ({
  id: `id-${index}`,
  outTradeNo: `order-${index}`,
  productId: 'plus_31d_v1',
  productName: 'Plus 31 天',
  amountFen: 600,
  status: 'fulfilled',
  createdAt: 1_700_000_000_000 + index,
  updatedAt: 1_700_000_000_000 + index,
})

beforeAll(async () => {
  ;(globalThis as any).Page = (value: Record<string, any>) => { definition = value }
  ;(globalThis as any).wx = {
    showModal: vi.fn(),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    showToast: vi.fn(),
    stopPullDownRefresh: vi.fn(),
  }
  await import('../miniprogram/pages/payment-orders/index')
})

beforeEach(() => {
  page = {
    ...definition,
    touchStartX: 0,
    touchStartY: 0,
    data: structuredClone(definition.data),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch) },
  }
  repository.listPaymentOrders.mockReset()
  repository.hidePaymentOrder.mockReset().mockResolvedValue(undefined)
  repository.getMembershipAccount.mockReset().mockResolvedValue({})
  vi.mocked(wx.showModal).mockReset()
  vi.mocked(wx.showLoading).mockReset()
  vi.mocked(wx.hideLoading).mockReset()
  vi.mocked(wx.showToast).mockReset()
})

describe('payment orders page', () => {
  it('loads records ten at a time and appends the next page', async () => {
    repository.listPaymentOrders
      .mockResolvedValueOnce({ orders: Array.from({ length: 10 }, (_, index) => order(index)), total: 11, nextOffset: 10, hasMore: true })
      .mockResolvedValueOnce({ orders: [order(10)], total: 11, nextOffset: 11, hasMore: false })

    await page.loadOrders(true)
    expect(page.data.orders).toHaveLength(10)
    expect(repository.listPaymentOrders).toHaveBeenCalledWith(0, 10)

    page.loadMore()
    await vi.waitFor(() => expect(page.data.orders).toHaveLength(11))
    expect(repository.listPaymentOrders).toHaveBeenLastCalledWith(10, 10)
    expect(page.data.hasMore).toBe(false)
  })

  it('keeps loaded orders and offers a manual retry when a later page fails', async () => {
    page.data.orders = Array.from({ length: 10 }, (_, index) => order(index))
    page.data.nextOffset = 10
    page.data.hasMore = true
    page.data.loading = false
    repository.listPaymentOrders
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ orders: [order(10)], total: 11, nextOffset: 11, hasMore: false })

    page.loadMore()
    await vi.waitFor(() => expect(page.data.loadFailed).toBe(true))
    expect(page.data.orders).toHaveLength(10)
    page.onReachBottom()
    expect(repository.listPaymentOrders).toHaveBeenCalledTimes(1)

    page.loadMore()
    await vi.waitFor(() => expect(page.data.orders).toHaveLength(11))
    expect(page.data.loadFailed).toBe(false)
  })

  it('reveals the hide action on a left swipe and keeps the backend order', async () => {
    page.data.orders = [order(1), order(2)]
    page.data.total = 2
    page.data.nextOffset = 2
    vi.mocked(wx.showModal).mockImplementation(({ success }: any) => success({ confirm: true }))

    page.onOrderTouchStart({ touches: [{ clientX: 160, clientY: 100 }] })
    page.onOrderTouchEnd({ currentTarget: { dataset: { no: 'order-1' } }, changedTouches: [{ clientX: 70, clientY: 104 }] })
    expect(page.data.revealedOrderNo).toBe('order-1')

    await page.onHideOrder({ currentTarget: { dataset: { no: 'order-1' } } })
    expect(repository.hidePaymentOrder).toHaveBeenCalledWith('order-1')
    expect(page.data.orders.map((item: any) => item.outTradeNo)).toEqual(['order-2'])
    expect(page.data.nextOffset).toBe(1)
    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('不会删除支付订单'),
    }))
  })

  it('reconciles pending payment results before refreshing the list', async () => {
    repository.listPaymentOrders.mockResolvedValueOnce({ orders: [], total: 0, nextOffset: 0, hasMore: false })
    await page.onSyncPaymentStatus()
    expect(repository.getMembershipAccount).toHaveBeenCalledOnce()
    expect(repository.listPaymentOrders).toHaveBeenCalledWith(0, 10)
    expect(wx.showToast).toHaveBeenCalledWith({ title: '支付状态已同步', icon: 'success' })
  })

  it('does not report a successful sync when the order list refresh fails', async () => {
    repository.listPaymentOrders.mockRejectedValueOnce(new Error('offline'))
    await page.onSyncPaymentStatus()
    expect(page.data.loadFailed).toBe(true)
    expect(wx.showToast).not.toHaveBeenCalledWith({ title: '支付状态已同步', icon: 'success' })
    expect(wx.showToast).toHaveBeenCalledWith({ title: '同步失败，请重试', icon: 'none' })
  })
})
