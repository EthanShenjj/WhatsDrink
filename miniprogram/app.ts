import { initializeCloud, loginForAccess } from './services/repository'

App<IAppOption>({
  globalData: {
    cloudEnabled: false,
  },
  onLaunch() {
    this.globalData.cloudEnabled = initializeCloud()
    loginForAccess()
      .then((profile) => {
        this.globalData.profile = profile
      })
      .catch(() => {
        // Repository already falls back to a local private profile.
      })
  },
})
