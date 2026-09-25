Component({
  properties: {
    photos: {
      type: Array,
      value: [] as string[],
    },
    max: {
      type: Number,
      value: 9,
    },
  },
  data: {
    photoList: [] as Array<{ url: string; index: number }>,
    showAdd: true,
    addLabel: '添加照片',
  },
  observers: {
    'photos, max'(photos: string[], max: number) {
      const list = (photos || []).map((url, index) => ({ url, index }))
      this.setData({
        photoList: list,
        showAdd: list.length < max,
        addLabel: list.length === 0 ? '添加照片' : `${list.length}/${max}`,
      })
    },
  },
  methods: {
    onAdd() {
      if (this.data.photoList.length >= this.data.max) return
      this.triggerEvent('add')
    },
    onRemove(e: WechatMiniprogram.TouchEvent) {
      const index = Number(e.currentTarget.dataset.index)
      this.triggerEvent('remove', { index })
    },
    onPreview(e: WechatMiniprogram.TouchEvent) {
      const index = Number(e.currentTarget.dataset.index)
      const urls = this.data.photoList.map((p) => p.url)
      wx.previewImage({ current: urls[index], urls })
    },
    preventMove() {},
  },
})
