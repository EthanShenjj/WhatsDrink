type PrivacyResolve = (
  result:
    | { event: 'agree'; buttonId: string }
    | { event: 'disagree' },
) => void

let pendingResolve: PrivacyResolve | null = null
const listenForPrivacy = wx.onNeedPrivacyAuthorization as unknown as (
  listener: (resolve: PrivacyResolve, eventInfo: { referrer: string }) => void,
) => void

Component({
  data: {
    visible: false,
  },
  lifetimes: {
    attached() {
      listenForPrivacy((resolve) => {
        pendingResolve = resolve
        this.setData({ visible: true })
      })
    },
  },
  methods: {
    agree() {
      pendingResolve?.({ event: 'agree', buttonId: 'agree-privacy' })
      pendingResolve = null
      this.setData({ visible: false })
    },
    disagree() {
      pendingResolve?.({ event: 'disagree' })
      pendingResolve = null
      this.setData({ visible: false })
    },
    openPrivacy() {
      wx.navigateTo({ url: '/pages/privacy/index' })
    },
    preventMove() {
      // 阻止弹窗下方页面滚动。
    },
  },
})
