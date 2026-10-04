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
    failedCount: { type: Number, value: 0 },
    max: {
      type: Number,
      value: 9,
    },
    disabled: { type: Boolean, value: false },
  },
  data: {
    photoList: [] as Array<{ key: number; url: string; originalUrl: string; index: number; pendingIndex: number; pending: boolean; failed: boolean }>,
    showAdd: true,
    addLabel: '添加照片',
  },
  observers: {
    'photos,thumbnails,pending,max,failedCount'(photos: string[], thumbnails: string[], pending: string[], max: number, failedCount: number) {
      const uploaded = (photos || []).map((originalUrl, index) => ({
        key: index,
        url: thumbnails?.[index] || originalUrl,
        originalUrl,
        index,
        pendingIndex: -1,
        pending: false,
        failed: false,
      }))
      const waiting = (pending || []).map((url, offset) => ({
        key: uploaded.length + offset, url, originalUrl: url, index: -1,
        pendingIndex: offset, pending: true, failed: offset < failedCount,
      }))
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
      if (this.data.disabled || this.data.photoList.length >= this.data.max) return
      this.triggerEvent('add')
    },
    onRemove(e: WechatMiniprogram.TouchEvent) {
      if (this.data.disabled) return
      const index = Number(e.currentTarget.dataset.index)
      const pendingIndex = Number(e.currentTarget.dataset.pendingIndex)
      this.triggerEvent('remove', { index, pendingIndex })
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
