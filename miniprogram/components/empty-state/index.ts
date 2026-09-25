Component({
  properties: {
    icon: { type: String, value: '✦' },
    state: { type: String, value: 'journey' },
    expression: { type: String, value: 'think' },
    title: { type: String, value: '这里还没有内容' },
    description: { type: String, value: '' },
    actionText: { type: String, value: '' },
  },
  methods: {
    onAction() {
      this.triggerEvent('action')
    },
  },
})
