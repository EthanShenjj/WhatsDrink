import { hasCloudAccess, initializeCloud, isSignedOut, loginForAccess, syncPendingFootprints } from './services/repository'
import { flushProductEvents, trackFirstOpen } from './services/product-events'

const refreshCloudSession = (app: WechatMiniprogram.App.Instance<IAppOption>, force = false): void => {
  if (isSignedOut()) return
  if (!initializeCloud()) {
    app.globalData.cloudEnabled = false
    return
  }
  loginForAccess({ force })
    .then((profile) => {
      app.globalData.profile = profile
      app.globalData.cloudEnabled = hasCloudAccess()
      void syncPendingFootprints().catch((error) => console.warn('[app] footprint sync failed', error))
      void flushProductEvents().catch((error) => console.warn('[app] event sync failed', error))
    })
    .catch(() => {
      app.globalData.cloudEnabled = false
    })
}

let cloudSessionScheduled = false
const scheduleCloudSession = (app: WechatMiniprogram.App.Instance<IAppOption>): void => {
  if (isSignedOut()) return
  if (cloudSessionScheduled) return
  cloudSessionScheduled = true
  // 把云初始化移出启动关键路径，先让本地缓存完成首屏绘制。
  setTimeout(() => {
    cloudSessionScheduled = false
    refreshCloudSession(app)
  }, 300)
}

App<IAppOption>({
  globalData: {
    cloudEnabled: false,
  },
  onLaunch() {
    trackFirstOpen()
    if (!isSignedOut()) scheduleCloudSession(this)
    wx.onNetworkStatusChange(({ isConnected }) => {
      if (isConnected && !isSignedOut()) refreshCloudSession(this, true)
    })
  },
  onShow() {
    if (isSignedOut()) {
      setTimeout(() => {
        const current = getCurrentPages()
        if (current[current.length - 1]?.route !== 'pages/account-gate/index') {
          wx.reLaunch({ url: '/pages/account-gate/index' })
        }
      }, 0)
      return
    }
    if (!hasCloudAccess()) scheduleCloudSession(this)
    else {
      void syncPendingFootprints().catch((error) => console.warn('[app] footprint sync failed', error))
      void flushProductEvents().catch((error) => console.warn('[app] event sync failed', error))
    }
  },
})
