import { recordInteraction } from '../utils/performance'

interface TabItem {
  pagePath: string
  text: string
  icon: string
}

const sheetTimers = new WeakMap<object, number>()

Component({
  data: {
    selected: 0,
    hidden: false,
    sheetVisible: false,
    sheetClosing: false,
    list: [
      { pagePath: '/pages/map/index', text: '地图', icon: 'map' },
      { pagePath: '/pages/time/index', text: '时光', icon: 'calendar' },
      { pagePath: '', text: '记录', icon: 'add-white' },
      { pagePath: '/pages/mine/index', text: '我的', icon: 'user' },
    ] as TabItem[],
  },
  methods: {
    noop() {
      /* 阻止弹层滚动穿透 */
    },
    switchTab(event: WechatMiniprogram.TouchEvent) {
      recordInteraction('tab.switch')
      const index = Number(event.currentTarget.dataset.index)
      const item = this.data.list[index]
      if (!item) return
      if (index === 2) {
        const timer = sheetTimers.get(this)
        if (timer) {
          clearTimeout(timer)
          sheetTimers.delete(this)
        }
        this.setData({ sheetVisible: true, sheetClosing: false })
        return
      }
      if (index === this.data.selected) return
      const previous = this.data.selected
      this.setData({ selected: index })
      wx.switchTab({
        url: item.pagePath,
        fail: () => this.setData({ selected: previous }),
      })
    },
    closeSheet() {
      if (!this.data.sheetVisible || this.data.sheetClosing) return
      this.setData({ sheetVisible: false, sheetClosing: true })
      const timerId = setTimeout(() => {
        sheetTimers.delete(this)
        this.setData({ sheetClosing: false })
      }, 260) as unknown as number
      sheetTimers.set(this, timerId)
    },
    chooseAction(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      this.setData({ sheetVisible: false, sheetClosing: false })
      wx.navigateTo({
        url: index === 0
          ? '/pages/footprint-form/index'
          : '/pages/footprint-form/index?status=wishlist',
      })
    },
  },
  lifetimes: {
    detached() {
      const timer = sheetTimers.get(this)
      if (timer) clearTimeout(timer)
      sheetTimers.delete(this)
    },
  },
})
