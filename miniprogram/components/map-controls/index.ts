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
  },
  data: {
    buttons: [
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
