Component({
  properties: {
    state: { type: String, value: 'journey' },
    label: { type: String, value: '启程蓝紫' },
    timeframe: { type: String, value: '' },
    locked: { type: Boolean, value: false },
    interactive: { type: Boolean, value: true },
  },
  methods: {
    onTap() {
      if (this.data.interactive) this.triggerEvent('tap')
    },
  },
})
