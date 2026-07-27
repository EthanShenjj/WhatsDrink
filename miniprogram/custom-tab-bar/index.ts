Component({
  data: {
    selected: 0,
    hidden: false,
    list: [
      { pagePath: '/pages/home/index', text: '今日', icon: 'home' },
      { pagePath: '/pages/calendar/index', text: '日历', icon: 'calendar' },
      { pagePath: '/pages/choice/index', text: 'Choice One', icon: 'chart-pie' },
      { pagePath: '/pages/profile/index', text: '我的', icon: 'user' },
    ],
  },
  methods: {
    switchTab(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      const item = this.data.list[index]
      if (!item) return
      this.setData({ selected: index })
      wx.switchTab({ url: item.pagePath })
    },
  },
})
