import { isSignedOut, resumeAccount, syncPendingFootprints } from '../../services/repository'
import { flushProductEvents } from '../../services/product-events'

Page({
  data: {
    entering: false,
    error: '',
  },

  onShow() {
    if (!isSignedOut()) wx.reLaunch({ url: '/pages/map/index' })
  },

  async onEnter() {
    if (this.data.entering) return
    this.setData({ entering: true, error: '' })
    try {
      const profile = await resumeAccount()
      getApp<IAppOption>().globalData.profile = profile
      getApp<IAppOption>().globalData.cloudEnabled = true
      void syncPendingFootprints().catch((error) => console.warn('[account-gate] sync failed', error))
      void flushProductEvents().catch((error) => console.warn('[account-gate] event sync failed', error))
      wx.reLaunch({ url: '/pages/map/index' })
    } catch (error) {
      this.setData({ error: error instanceof Error ? error.message : '重新进入失败，请稍后重试' })
    } finally {
      this.setData({ entering: false })
    }
  },
})
