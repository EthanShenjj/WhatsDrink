import { ensureProfile, initializeCloud } from './services/repository'
import type { UserProfile } from './domain/types'

interface GlobalData {
  cloudEnabled: boolean
  profile?: UserProfile
}

App<IAppOption>({
  globalData: {
    cloudEnabled: false,
  } as GlobalData,
  onLaunch() {
    this.globalData.cloudEnabled = initializeCloud()
    const bootstrap = () => {
      ensureProfile()
        .then((profile) => {
          this.globalData.profile = profile
        })
        .catch(() => {
          wx.showToast({ title: '登录初始化失败', icon: 'none' })
        })
    }
    wx.login({
      success: bootstrap,
      fail: () => {
        if (this.globalData.cloudEnabled) {
          wx.showToast({ title: '微信登录失败，请重试', icon: 'none' })
          return
        }
        bootstrap()
      },
    })
  },
})
