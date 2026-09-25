interface TabItem {
  pagePath: string
  text: string
  icon: string
}

Component({
  data: {
    selected: 0,
    hidden: false,
    list: [
      { pagePath: '/pages/map/index', text: '地图', icon: 'map' },
      { pagePath: '/pages/time/index', text: '时光', icon: 'calendar' },
      { pagePath: '', text: '记录', icon: 'add-white' },
      { pagePath: '/pages/mine/index', text: '我的', icon: 'user' },
    ] as TabItem[],
  },
  methods: {
    switchTab(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      const item = this.data.list[index]
      if (!item) return
      if (index === 2) {
        wx.showActionSheet({
          itemList: ['记录足迹', '添加想去'],
          success: ({ tapIndex }) => {
            const url = tapIndex === 0
              ? '/pages/footprint-form/index'
              : '/pages/footprint-form/index?status=wishlist'
            wx.navigateTo({ url })
          },
        })
        return
      }
      if (index === this.data.selected) return
      this.setData({ selected: index })
      wx.switchTab({ url: item.pagePath })
    },
  },
})
