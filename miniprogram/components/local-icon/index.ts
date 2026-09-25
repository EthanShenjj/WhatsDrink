Component({
  properties: {
    name: {
      type: String,
      value: '',
    },
    size: {
      type: String,
      value: '32rpx',
    },
    color: {
      type: String,
      value: '',
    },
  },
  data: {
    iconSrc: '',
  },
  observers: {
    name(value: string) {
      this.setData({
        iconSrc: value ? `/assets/icons/${value}.svg` : '',
      })
    },
  },
  lifetimes: {
    attached() {
      if (this.data.name) {
        this.setData({
          iconSrc: `/assets/icons/${this.data.name}.svg`,
        })
      }
    },
  },
})
