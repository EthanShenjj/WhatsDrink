interface ControlButton {
  key: string
  icon: string
  label: string
  event: string
}

Component({
  properties: {
    locating: { type: Boolean, value: false },
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
  },
  data: {
    buttons: [
      { key: 'locate', icon: 'locate', label: '回到我的位置', event: 'locate' },
      { key: 'reload', icon: 'refresh', label: '重新加载地图', event: 'reload' },
      { key: 'filter', icon: 'filter', label: '筛选', event: 'filter' },
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
