interface ControlButton {
  key: string
  icon: string
  label: string
  event: string
}

Component({
  properties: {
    mode: {
      type: String,
      value: 'visited',
    },
    clusterEnabled: {
      type: Boolean,
      value: true,
    },
    filterActive: {
      type: Boolean,
      value: false,
    },
    raised: {
      type: Boolean,
      value: false,
    },
    showShare: {
      type: Boolean,
      value: true,
    },
  },
  data: {
    buttons: [
      { key: 'locate', icon: 'locate', label: '定位', event: 'locate' },
      { key: 'search', icon: 'search', label: '搜索', event: 'search' },
      { key: 'filter', icon: 'filter', label: '筛选', event: 'filter' },
      { key: 'settings', icon: 'settings', label: '设置', event: 'settings' },
      { key: 'share', icon: 'share', label: '分享', event: 'share' },
    ] as ControlButton[],
  },
  methods: {
    onTap(e: WechatMiniprogram.TouchEvent) {
      const event = String(e.currentTarget.dataset.event)
      if (!event) return
      this.triggerEvent(event, { action: event })
    },
  },
})
