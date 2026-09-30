const lastIconSources = new WeakMap<object, string>()

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
      const iconSrc = value ? `/assets/icons/${value}.svg` : ''
      if (iconSrc === lastIconSources.get(this)) return
      lastIconSources.set(this, iconSrc)
      this.setData({
        iconSrc,
      })
    },
  },
  lifetimes: {
    attached() {
      if (this.data.name && !this.data.iconSrc) {
        const iconSrc = `/assets/icons/${this.data.name}.svg`
        lastIconSources.set(this, iconSrc)
        this.setData({
          iconSrc,
        })
      }
    },
    detached() {
      lastIconSources.delete(this)
    },
  },
})
