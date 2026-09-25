Component({
  properties: {
    type: { type: String, value: 'empty' },
    state: { type: String, value: 'journey' },
    expression: { type: String, value: 'think' },
    title: { type: String, value: '这里还没有内容' },
    description: { type: String, value: '' },
    actionText: { type: String, value: '' },
    compact: { type: Boolean, value: false },
  },
  methods: {
    onAction() {
      this.triggerEvent('action')
    },
  },
})
