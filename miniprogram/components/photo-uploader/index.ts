Component({
  properties: {
    photos: {
      type: Array,
      value: [] as string[],
    },
    thumbnails: {
      type: Array,
      value: [] as string[],
    },
    pending: {
      type: Array,
      value: [] as string[],
    },
    max: {
      type: Number,
      value: 9,
    },
  },
  data: {
    photoList: [] as Array<{ url: string; originalUrl: string; index: number; pending: boolean }>,
    showAdd: true,
    addLabel: '添加照片',
  },
  observers: {
    'photos,thumbnails,pending,max'(photos: string[], thumbnails: string[], pending: string[], max: number) {
      const uploaded = (photos || []).map((originalUrl, index) => ({
        url: thumbnails?.[index] || originalUrl,
        originalUrl,
        index,
        pending: false,
      }))
      const waiting = (pending || []).map((url) => ({ url, originalUrl: url, index: -1, pending: true }))
      const list = [...uploaded, ...waiting]
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
      if (index < 0) return
      const urls = this.data.photoList.filter((p) => !p.pending).map((p) => p.originalUrl)
      wx.previewImage({ current: urls[index], urls })
    },
    preventMove() {},
  },
})
