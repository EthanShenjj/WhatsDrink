import { initializeCloud } from './services/repository'

App<IAppOption>({
  globalData: {
    cloudEnabled: false,
  },
  onLaunch() {
    this.globalData.cloudEnabled = initializeCloud()
  },
})
