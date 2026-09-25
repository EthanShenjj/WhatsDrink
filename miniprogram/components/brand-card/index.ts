Component({
  properties: {
    variant: { type: String, value: 'default' },
    interactive: { type: Boolean, value: false },
    ariaLabel: { type: String, value: '' },
  },
  methods: {
    onTap() {
      if (this.data.interactive) this.triggerEvent('tap')
    },
  },
})
