import type { Footprint, UserProfile } from '../domain/types'

declare global {
  interface IAppOption {
    globalData: {
      cloudEnabled: boolean
      profile?: UserProfile
      footprints?: Footprint[]
      footprintsCachedAt?: number
    }
  }
}

export {}
