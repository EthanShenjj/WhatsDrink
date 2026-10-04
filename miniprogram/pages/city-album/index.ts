import boundaries from '../../data/province-boundaries'
import type { Footprint } from '../../domain/types'
import { listFootprints } from '../../services/repository'
import { provinceOverviews } from '../../utils/province-map'
import { trackProductEvent } from '../../services/product-events'

type DrawContext = {
  fillStyle: string; strokeStyle: string; lineWidth: number; font: string; textAlign: CanvasTextAlign
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number, maxWidth?: number): void
  beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void
  closePath(): void; fill(): void; stroke(): void; setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  drawImage(image: never, x: number, y: number, width: number, height: number): void
}
type CanvasImage = { src: string; onload: (() => void) | null; onerror: (() => void) | null }
type CanvasNode = { width: number; height: number; getContext(kind: '2d'): DrawContext; createImage(): CanvasImage }

interface AlbumData {
  cityCount: number
  includePlaces: boolean
  includeNotes: boolean
  includePhoto: boolean
  hasPlaces: boolean
  hasNotes: boolean
  hasPhoto: boolean
  saving: boolean
  rendering: boolean
  loading: boolean
  loadFailed: boolean
}

Page<AlbumData, WechatMiniprogram.IAnyObject>({
  records: [] as Footprint[],
  canvasNode: null as CanvasNode | null,
  drawVersion: 0,
  data: { cityCount: 0, includePlaces: false, includeNotes: false, includePhoto: false, hasPlaces: false, hasNotes: false, hasPhoto: false, saving: false, rendering: false, loading: true, loadFailed: false },

  async onReady() {
    await this.loadRecords()
    wx.createSelectorQuery().in(this).select('#albumCanvas').fields({ node: true, size: true }).exec((result) => {
      const field = result?.[0] as { node?: CanvasNode; width?: number; height?: number } | undefined
      if (!field?.node || !field.width || !field.height) return
      const node = field.node
      const ratio = wx.getWindowInfo().pixelRatio || 1
      node.width = Math.round(field.width * ratio)
      node.height = Math.round(field.height * ratio)
      this.canvasNode = node
      this.draw()
    })
  },

  async loadRecords() {
    this.setData({ loading: true, loadFailed: false })
    try {
      this.records = await listFootprints()
    } catch (error) {
      console.warn('[city-album] load failed', error)
      this.setData({ loading: false, loadFailed: true })
      return
    }
    const visited = (this.records as Footprint[]).filter((record) => record.status === 'visited')
    const cityCount = provinceOverviews(this.records as Footprint[]).reduce((sum, overview) => sum + overview.cities, 0)
    this.setData({
      cityCount,
      hasPlaces: visited.some((record) => record.recordLevel !== 'city'),
      hasNotes: visited.some((record) => record.recordLevel !== 'city' && record.note),
      hasPhoto: visited.some((record) => record.recordLevel !== 'city' && (record.photoThumbs?.length || record.photos?.length)),
      loading: false,
    })
    this.draw()
  },

  onRetryLoad() { if (!this.data.loading) void this.loadRecords() },

  togglePlaces(e: WechatMiniprogram.SwitchChange) { if (this.data.hasPlaces) this.setData({ includePlaces: Boolean(e.detail.value) }, () => this.draw()) },
  togglePhoto(e: WechatMiniprogram.SwitchChange) { if (this.data.hasPhoto) this.setData({ includePhoto: Boolean(e.detail.value) }, () => this.draw()) },
  toggleNotes(e: WechatMiniprogram.SwitchChange) { if (this.data.hasNotes) this.setData({ includeNotes: Boolean(e.detail.value) }, () => this.draw()) },

  draw() {
    const canvas = this.canvasNode
    if (!canvas) return
    const version = ++this.drawVersion
    this.setData({ rendering: this.data.includePhoto })
    const context = canvas.getContext('2d')
    const ratio = canvas.width / 686
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.fillStyle = '#FCFDFF'
    context.fillRect(0, 0, 686, 920)
    context.fillStyle = '#596AFF'
    context.font = 'bold 23px sans-serif'
    context.textAlign = 'left'
    context.fillText('拾光迹 · 我的城市版图', 42, 72)
    context.fillStyle = '#202744'
    context.font = 'bold 52px sans-serif'
    context.fillText(`${this.data.cityCount} 座城市`, 42, 146)
    const overviews = provinceOverviews(this.records as Footprint[])
    context.fillStyle = '#747C98'
    context.font = '24px sans-serif'
    context.fillText(`已点亮 ${overviews.length} 个省区`, 44, 186)

    const lit = new Set(overviews.map((item) => item.name))
    const mapX = (longitude: number) => 50 + (longitude - 73) * 9.1
    const mapY = (latitude: number) => 555 - (latitude - 18) * 10.7
    Object.entries(boundaries).forEach(([province, rings]) => {
      context.fillStyle = lit.has(province) ? '#8290FF' : '#E5E9F4'
      context.strokeStyle = '#FFFFFF'
      context.lineWidth = 1.4
      rings.forEach((ring) => {
        if (!ring.length) return
        context.beginPath()
        context.moveTo(mapX(ring[0][0]), mapY(ring[0][1]))
        ring.slice(1).forEach(([lng, lat]) => context.lineTo(mapX(lng), mapY(lat)))
        context.closePath()
        context.fill()
        context.stroke()
      })
    })

    context.fillStyle = '#202744'
    context.font = 'bold 25px sans-serif'
    context.fillText('点亮的地方', 42, 636)
    context.fillStyle = '#67718F'
    context.font = '21px sans-serif'
    const cityLines = overviews.flatMap((item) => item.cityNames.map((city) => `${item.name.replace(/(省|市|自治区|特别行政区)$/, '')} · ${city}`))
    if (!cityLines.length) context.fillText('还没有点亮城市', 42, 682)
    cityLines.slice(0, 8).forEach((line, index) => {
      const x = index < 4 ? 42 : 354
      const y = 682 + (index % 4) * 37
      context.fillText(line, x, y, 275)
    })
    if (cityLines.length > 8) context.fillText(`还有 ${cityLines.length - 8} 座城市已点亮`, 42, 835)
    const places = (this.records as Footprint[]).filter((item) => item.status === 'visited' && item.recordLevel !== 'city')
    if (this.data.includePlaces && places.length) {
      context.fillStyle = '#4755B9'
      context.font = '19px sans-serif'
      context.fillText(`地点：${[...new Set(places.map((item) => item.poiName))].slice(0, 3).join('、')}`, 42, 866, 602)
    }
    if (this.data.includeNotes) {
      const note = places.find((item) => item.note)?.note
      if (note) {
        context.fillStyle = '#4755B9'
        context.font = '18px sans-serif'
        context.fillText(`记忆：${note.replace(/\s+/g, ' ').slice(0, 28)}`, 42, 898, 602)
      }
    }
    if (this.data.includePhoto) void this.drawSelectedPhoto(canvas, context, version)
  },

  async drawSelectedPhoto(canvas: CanvasNode, context: DrawContext, version: number) {
    const record = (this.records as Footprint[]).find((item) => item.status === 'visited' && item.recordLevel !== 'city' && (item.photoThumbs?.[0] || item.photos?.[0]))
    const photo = record?.photoThumbs?.[0] || record?.photos?.[0]
    if (!photo) { this.setData({ rendering: false }); return }
    try {
      const path = photo.startsWith('cloud://') && wx.cloud
        ? await new Promise<string>((resolve, reject) => wx.cloud.downloadFile({ fileID: photo, success: ({ tempFilePath }) => resolve(tempFilePath), fail: reject }))
        : photo
      const image = canvas.createImage()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('照片无法加载'))
        image.src = path
      })
      if (version !== this.drawVersion || !this.data.includePhoto) return
      context.fillStyle = '#EEF0FF'
      context.fillRect(496, 26, 148, 148)
      context.drawImage(image as never, 502, 32, 136, 136)
      this.setData({ rendering: false })
    } catch {
      if (version !== this.drawVersion) return
      this.setData({ includePhoto: false, rendering: false }, () => this.draw())
      wx.showToast({ title: '照片暂时无法加入', icon: 'none' })
    }
  },

  onSave() {
    if (!this.canvasNode || !this.data.cityCount || this.data.saving || this.data.rendering || this.data.loading || this.data.loadFailed) return
    this.setData({ saving: true })
    wx.canvasToTempFilePath({
      canvas: this.canvasNode as never, fileType: 'png',
      success: ({ tempFilePath }) => wx.saveImageToPhotosAlbum({
        filePath: tempFilePath,
        success: () => { this.setData({ saving: false }); trackProductEvent('album_saved'); wx.showToast({ title: '已保存到相册', icon: 'success' }) },
        fail: (error) => {
          this.setData({ saving: false })
          if (String(error.errMsg).includes('auth')) wx.showModal({ title: '需要相册权限', content: '请在微信设置中允许保存图片到相册。', confirmText: '去设置', success: ({ confirm }) => { if (confirm) wx.openSetting({}) } })
          else wx.showToast({ title: '保存失败，请重试', icon: 'none' })
        },
      }),
      fail: () => { this.setData({ saving: false }); wx.showToast({ title: '生成图片失败', icon: 'none' }) },
    }, this)
  },
})
