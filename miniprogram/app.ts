import { hasCloudAccess, initializeCloud, loginForAccess } from './services/repository'

const refreshCloudSession = (app: WechatMiniprogram.App.Instance<IAppOption>): void => {
  if (!initializeCloud()) {
    app.globalData.cloudEnabled = false
    return
  }
  loginForAccess()
    .then((profile) => {
      app.globalData.profile = profile
      app.globalData.cloudEnabled = hasCloudAccess()
    })
    .catch(() => {
      app.globalData.cloudEnabled = false
    })
}

let cloudSessionScheduled = false
const scheduleCloudSession = (app: WechatMiniprogram.App.Instance<IAppOption>): void => {
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
    scheduleCloudSession(this)
  },
  onShow() {
    if (!hasCloudAccess()) scheduleCloudSession(this)
  },
})
