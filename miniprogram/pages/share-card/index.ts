import type { Footprint, LightingStats, ShareCardConfig } from '../../domain/types'
import { getFootprint, getShareCodePath, listFootprints, saveShareSnapshot } from '../../services/repository'
import { computeLighting } from '../../utils/footprint'
import { createId } from '../../utils/id'
import { formatVisitDate } from '../../utils/date'
import { moodEmoji, moodLabel } from '../../data/options'

interface PageData {
  footprint?: Footprint
  mapStats?: LightingStats
  mapCities: string[]
  mapLabel: string
  mapHighlight: string
  config: ShareCardConfig
  loading: boolean
  generating: boolean
  imageUrl: string
  codeAvailable: boolean
}

const drawablePhotoPath = async (src: string): Promise<string | undefined> => {
  let imageSrc = src
  if (src.startsWith('cloud://')) {
    try {
      const downloaded = await wx.cloud.downloadFile({ fileID: src })
      imageSrc = downloaded.tempFilePath
    } catch {
      return undefined
    }
  }
  return new Promise((resolve) => {
    wx.getImageInfo({
      src: imageSrc,
      success: ({ path }) => resolve(path),
      fail: () => resolve(undefined),
    })
  })
}

Page<PageData, WechatMiniprogram.IAnyObject>({
  data: {
    footprint: undefined,
    mapStats: undefined,
    mapCities: [],
    mapLabel: '足迹总览',
    mapHighlight: '',
    config: {
      type: 'place',
      hideAddress: true,
      hideDate: false,
      hideNote: false,
    },
    loading: true,
    generating: false,
    imageUrl: '',
    codeAvailable: false,
  },

  async onLoad(query: Record<string, string>) {
    if (query.type === 'map') {
      try {
        const all = await listFootprints()
        const ids = wx.getStorageSync<string[]>('sgj:share-map-ids')
        wx.removeStorageSync('sgj:share-map-ids')
        const chosen = query.year
          ? all.filter((item) => item.status === 'visited'
            ? item.visitDate?.startsWith(query.year)
            : item.status === 'fulfilled' && new Date(item.fulfilledAt || 0).getFullYear() === Number(query.year))
          : query.month
            ? all.filter((item) => item.status === 'visited'
              ? item.visitDate?.startsWith(query.month)
              : item.status === 'fulfilled' && new Date(item.fulfilledAt || 0).toISOString().startsWith(query.month))
          : Array.isArray(ids)
            ? all.filter((item) => ids.includes(item.id))
            : all
        const mapStats = computeLighting(chosen)
        const cityVisits = new Map<string, number>()
        for (const item of chosen) {
          if (item.status === 'visited' && item.city) cityVisits.set(item.city, (cityVisits.get(item.city) || 0) + 1)
        }
        const topCity = [...cityVisits].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
        this.setData({
          config: { ...this.data.config, type: 'map' },
          mapStats,
          mapCities: mapStats.litCities.slice(0, 12),
          mapLabel: query.year
            ? `我的 ${query.year} 世界`
            : query.month
              ? `我的 ${Number(query.month.slice(5, 7))} 月拾光`
              : query.mode === 'lighting' ? '已点亮地图' : '我的足迹地图',
          mapHighlight: query.year || query.month
            ? `${query.month ? '这个月' : '这一年'}实现 ${mapStats.fulfilledWishCount} 个愿望${topCity ? ` · 走进 ${topCity}` : ''}`
            : '',
          loading: false,
        })
      } catch {
        this.setData({ loading: false })
        wx.showToast({ title: '地图卡加载失败', icon: 'none' })
      }
      return
    }
    if (!query.footprintId) {
      this.setData({ loading: false })
      return
    }
    try {
      const footprint = await getFootprint(query.footprintId)
      this.setData({ footprint, loading: false })
      if (!footprint) wx.showToast({ title: '足迹不存在', icon: 'none' })
    } catch {
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onPrivacyChange(e: WechatMiniprogram.SwitchChange) {
    const key = String(e.currentTarget.dataset.key) as 'hideAddress' | 'hideDate' | 'hideNote'
    this.setData({ [`config.${key}`]: e.detail.value, imageUrl: '' })
  },

  async generateCard(): Promise<string> {
    if (this.data.imageUrl) return this.data.imageUrl
    const fp = this.data.footprint
    if (this.data.config.type === 'place' && !fp) throw new Error('足迹不存在')
    if (this.data.config.type === 'map' && !this.data.mapStats) throw new Error('地图数据不存在')
    this.setData({ generating: true })

    const ctx = wx.createCanvasContext('shareCanvas', this)
    const width = 750
    const height = 1040
    const mascotPath = await drawablePhotoPath('/assets/growth/journey.webp')
    ctx.setFillStyle('#F7F8FF')
    ctx.fillRect(0, 0, width, height)
    ctx.setFillStyle('#5B6CFF')
    ctx.fillRect(0, 0, width, 18)

    ctx.setFillStyle('#17182B')
    ctx.setFontSize(30)
    ctx.fillText('拾光迹', 52, 78)
    ctx.setFillStyle('#6F7489')
    ctx.setFontSize(16)
    ctx.fillText('LIFEMAP · YOUR WORLD IN MOMENTS', 52, 106)
    if (mascotPath) ctx.drawImage(mascotPath, 600, 24, 104, 104)

    if (this.data.config.type === 'map') {
      const stats = this.data.mapStats!
      ctx.setFillStyle('#17182B')
      ctx.setFontSize(48)
      ctx.fillText(this.data.mapLabel, 52, 230)
      ctx.setFillStyle('#5B6CFF')
      ctx.setFontSize(110)
      ctx.fillText(String(stats.places), 52, 385)
      ctx.setFillStyle('#6F7489')
      ctx.setFontSize(28)
      ctx.fillText('个到访地点', 210, 370)
      ctx.setFillStyle('#E9EBFF')
      ctx.fillRect(52, 440, 646, 165)
      ctx.setFillStyle('#17182B')
      ctx.setFontSize(30)
      ctx.fillText(`${stats.provinces} 个省/州`, 82, 515)
      ctx.fillText(`${stats.cities} 座城市`, 400, 515)
      ctx.setFontSize(24)
      ctx.fillText(`${stats.visitedCount} 次到访 · ${stats.photoCount} 张照片`, 82, 565)
      if (this.data.mapHighlight) {
        ctx.setFontSize(22)
        ctx.fillText(this.data.mapHighlight, 52, 640)
      }
      ctx.setFontSize(25)
      ctx.fillText('被点亮的城市', 52, 690)
      ctx.setFontSize(22)
      this.drawWrappedText(ctx, this.data.mapCities.join('  ·  ') || '从第一处回忆开始', 52, 745, 646, 40, 3)
    } else if (fp) {
      const photoPaths = await Promise.all(fp.photos.slice(0, 3).map(drawablePhotoPath))
      const drawable = photoPaths.filter((path): path is string => Boolean(path))
      const gap = 8
      const photoWidth = (646 - gap * (drawable.length - 1)) / (drawable.length || 1)
      drawable.forEach((path, index) => {
        ctx.drawImage(path, 52 + index * (photoWidth + gap), 148, photoWidth, 330)
      })
      ctx.setFillStyle(fp.markerStyle?.color || '#5B6CFF')
      ctx.beginPath()
      ctx.arc(94, 526, 28, 0, Math.PI * 2)
      ctx.fill()
      ctx.setFillStyle('#17182B')
      ctx.setFontSize(44)
      this.drawWrappedText(ctx, fp.poiName, 142, 532, 555, 52, 2)
      const safeLocation = [fp.city, fp.poiName].filter(Boolean).join(' · ')
      const location = this.data.config.hideAddress ? safeLocation : fp.address || safeLocation
      ctx.setFillStyle('#6F7489')
      ctx.setFontSize(23)
      this.drawWrappedText(ctx, location, 52, 630, 646, 32, 2)
      const meta: string[] = []
      if (!this.data.config.hideDate && fp.visitDate) meta.push(formatVisitDate(fp.visitDate))
      if (fp.mood) meta.push(`${moodEmoji(fp.mood)} ${moodLabel(fp.mood)}`)
      if (meta.length) {
        ctx.setFillStyle('#3E47C8')
        ctx.setFontSize(24)
        ctx.fillText(meta.join('  ·  '), 52, 705)
      }
      if (!this.data.config.hideNote && fp.note) {
        ctx.setFillStyle('#343650')
        ctx.setFontSize(25)
        this.drawWrappedText(ctx, `“${fp.note}”`, 52, 755, 646, 38, 3)
      }
    }

    const shareCodePath = await getShareCodePath()
    this.setData({ codeAvailable: Boolean(shareCodePath) })
    ctx.setStrokeStyle('rgba(91,108,255,0.28)')
    ctx.setLineDash([8, 8], 0)
    ctx.beginPath()
    ctx.moveTo(52, 906)
    ctx.lineTo(698, 906)
    ctx.stroke()
    ctx.setFillStyle('#6F7489')
    ctx.setFontSize(20)
    ctx.fillText('把走过的地方，留成一张会长大的地图', 52, 958)
    if (shareCodePath) {
      ctx.drawImage(shareCodePath, 600, 914, 90, 90)
    } else {
      ctx.setFontSize(16)
      ctx.fillText('微信搜索 拾光迹', 584, 995)
    }

    return new Promise<string>((resolve, reject) => {
      ctx.draw(false, () => {
        wx.canvasToTempFilePath(
          {
            canvasId: 'shareCanvas',
            x: 0,
            y: 0,
            width,
            height,
            destWidth: 750,
            destHeight: 1040,
            fileType: 'png',
            quality: 1,
            success: async (res) => {
              const savedPath = await new Promise<string>((done) => {
                wx.getFileSystemManager().saveFile({
                  tempFilePath: res.tempFilePath,
                  success: (saved) => done(saved.savedFilePath),
                  fail: () => done(res.tempFilePath),
                })
              })
              this.setData({ imageUrl: savedPath, generating: false })
              await saveShareSnapshot({
                id: createId('share'),
                type: this.data.config.type,
                imageUrl: savedPath,
                createdAt: Date.now(),
              }).catch(() => undefined)
              resolve(savedPath)
            },
            fail: (err) => {
              this.setData({ generating: false })
              reject(err)
            },
          },
          this,
        )
      })
    })
  },

  drawWrappedText(
    ctx: WechatMiniprogram.CanvasContext,
    value: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines: number,
  ) {
    const chars = Array.from(value)
    const lines: string[] = []
    let line = ''
    chars.forEach((char) => {
      const candidate = `${line}${char}`
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line)
        line = char
      } else {
        line = candidate
      }
    })
    if (line) lines.push(line)
    lines.slice(0, maxLines).forEach((item, index) => {
      const suffix = index === maxLines - 1 && lines.length > maxLines ? '…' : ''
      ctx.fillText(`${item}${suffix}`, x, y + index * lineHeight)
    })
  },

  async onSaveImage() {
    try {
      wx.showLoading({ title: '生成卡片…', mask: true })
      const filePath = await this.generateCard()
      wx.hideLoading()
      await new Promise<void>((resolve, reject) => {
        wx.saveImageToPhotosAlbum({ filePath, success: () => resolve(), fail: reject })
      })
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch {
      wx.hideLoading()
      wx.showModal({
        title: '保存失败',
        content: '请允许“保存到相册”权限后重试。',
        confirmText: '去设置',
        success: (res) => {
          if (res.confirm) wx.openSetting({})
        },
      })
    }
  },

  async onGenerate() {
    try {
      wx.showLoading({ title: '生成卡片…', mask: true })
      await this.generateCard()
      wx.hideLoading()
      wx.showToast({ title: '分享卡已生成', icon: 'success' })
    } catch {
      wx.hideLoading()
      wx.showToast({ title: '生成失败，请重试', icon: 'none' })
    }
  },

  onShareAppMessage() {
    const fp = this.data.footprint
    return {
      title: fp ? `我在 ${fp.poiName} 留下了一段回忆` : '我的拾光地图',
      path: '/pages/map/index',
      imageUrl: this.data.imageUrl || fp?.photos[0] || undefined,
    }
  },
})
