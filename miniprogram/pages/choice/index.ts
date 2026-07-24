import type { Wheel, WheelItem } from '../../domain/types'
import { createWheel, listWheels } from '../../services/repository'
import { STORAGE_KEYS } from '../../services/config'
import {
  chooseWheelItem,
  getWheelLabelRotation,
  validateWheelItems,
  wheelItemToDraft,
} from '../../utils/wheel'

interface Canvas2DLike {
  fillStyle: string
  font: string
  textAlign: 'center'
  textBaseline: 'middle'
  clearRect(x: number, y: number, width: number, height: number): void
  scale(x: number, y: number): void
  save(): void
  restore(): void
  translate(x: number, y: number): void
  rotate(angle: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arc(x: number, y: number, radius: number, start: number, end: number): void
  closePath(): void
  fill(): void
  fillText(text: string, x: number, y: number, maxWidth?: number): void
}

interface CanvasLike {
  width: number
  height: number
  getContext(type: '2d'): Canvas2DLike
  requestAnimationFrame?(callback: (time: number) => void): number
}

interface WheelSurfaceLike {
  refresh(): void
  getCanvasState(): {
    canvas: CanvasLike | null
    size: number
  }
}

const COLORS = ['#D96C4A', '#E6B66F', '#6F8FA6', '#9CAF88', '#C98D75', '#B29A7E']
const LABEL_COLORS = ['#FFF9EF', '#4A2E1F', '#FFF9EF', '#4A2E1F', '#4A2E1F', '#4A2E1F']
const REDUCED_MOTION_KEY = 'whatsdrink-choice-reduced-motion'

Page({
  data: {
    wheels: [] as Wheel[],
    wheelNames: [] as string[],
    activeIndex: 0,
    activeWheel: null as Wheel | null,
    spinning: false,
    result: null as WheelItem | null,
    validationMessage: '',
    candidateSummary: '',
    candidateCount: 0,
    reducedMotion: false,
  },
  canvas: null as CanvasLike | null,
  canvasSize: 0,
  rotation: 0,
  onLoad() {
    this.setData({ reducedMotion: Boolean(wx.getStorageSync(REDUCED_MOTION_KEY)) })
  },
  onShow() {
    this.getTabBar?.()?.setData({ selected: 2 })
    this.loadWheels()
  },
  onReady() {
    this.bindWheelCanvas()
  },
  async loadWheels() {
    const wheels = await listWheels()
    const activeIndex = Math.min(this.data.activeIndex, wheels.length - 1)
    this.setData({
      wheels,
      wheelNames: wheels.map((wheel) => wheel.name),
      activeIndex,
      activeWheel: wheels[activeIndex],
      result: null,
      validationMessage: validateWheelItems(wheels[activeIndex]?.items || []) || '',
      candidateSummary: (wheels[activeIndex]?.items || []).map((item) => item.label).join('、'),
      candidateCount: wheels[activeIndex]?.items.length || 0,
    })
    wx.nextTick(() => this.bindWheelCanvas())
  },
  onWheelCanvasReady() {
    this.bindWheelCanvas()
  },
  bindWheelCanvas() {
    const surface = this.selectComponent('#wheelSurface') as unknown as WheelSurfaceLike | null
    const state = surface?.getCanvasState()
    if (!state?.canvas || !state.size) {
      surface?.refresh()
      return
    }
    this.canvas = state.canvas
    this.canvasSize = state.size
    this.drawWheel()
  },
  changeWheel(event: WechatMiniprogram.PickerChange) {
    const index = Number(event.detail.value)
    const activeWheel = this.data.wheels[index]
    this.rotation = 0
    this.setData({
      activeIndex: index,
      activeWheel,
      result: null,
      validationMessage: validateWheelItems(activeWheel.items) || '',
      candidateSummary: activeWheel.items.map((item) => item.label).join('、'),
      candidateCount: activeWheel.items.length,
    })
    this.drawWheel()
  },
  drawWheel(rotation?: number, labelsFollowWheel = false) {
    if (!this.canvas || !this.canvasSize || !this.data.activeWheel) return
    const currentRotation = rotation ?? this.rotation
    const context = this.canvas.getContext('2d')
    const size = this.canvasSize
    const center = size / 2
    const radius = center - 10
    const items = this.data.activeWheel.items
    context.clearRect(0, 0, size, size)
    if (!items.length) return
    const sector = (Math.PI * 2) / items.length
    context.save()
    context.translate(center, center)
    context.rotate(currentRotation)
    items.forEach((item, index) => {
      const start = index * sector - Math.PI / 2
      const end = start + sector
      context.beginPath()
      context.moveTo(0, 0)
      context.arc(0, 0, radius, start, end)
      context.closePath()
      context.fillStyle = COLORS[index % COLORS.length]
      context.fill()
      context.save()
      const middle = start + sector / 2
      context.rotate(middle)
      context.translate(radius * 0.6, 0)
      context.rotate(getWheelLabelRotation(middle, currentRotation, labelsFollowWheel))
      context.fillStyle = LABEL_COLORS[index % LABEL_COLORS.length]
      context.font = `${items.length > 10 ? 11 : 13}px "Songti SC", serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      const maxLabelLength = items.length > 10 ? 5 : 7
      const label =
        item.label.length > maxLabelLength
          ? `${item.label.slice(0, maxLabelLength)}…`
          : item.label
      context.fillText(label, 0, 0, radius * 0.54)
      context.restore()
    })
    context.beginPath()
    context.arc(0, 0, 26, 0, Math.PI * 2)
    context.fillStyle = '#4A2E1F'
    context.fill()
    context.restore()
    context.beginPath()
    context.moveTo(center, 4)
    context.lineTo(center - 14, 34)
    context.lineTo(center + 14, 34)
    context.closePath()
    context.fillStyle = '#4A2E1F'
    context.fill()
  },
  spin() {
    if (this.data.spinning || !this.data.activeWheel) return
    const validationMessage = validateWheelItems(this.data.activeWheel.items)
    if (validationMessage) {
      this.setData({ validationMessage })
      wx.showToast({ title: validationMessage, icon: 'none' })
      return
    }
    const selected = chooseWheelItem(this.data.activeWheel.items)
    const selectedIndex = this.data.activeWheel.items.findIndex((item) => item.id === selected.id)
    const sector = (Math.PI * 2) / this.data.activeWheel.items.length
    const normalized = ((this.rotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
    const desired = -(selectedIndex + 0.5) * sector
    if (this.data.reducedMotion) {
      this.rotation = desired
      this.drawWheel(this.rotation)
      this.setData({ result: selected, spinning: false })
      return
    }
    const alignment = ((desired - normalized + Math.PI * 2) % (Math.PI * 2)) + Math.PI * 2 * 6
    const startRotation = this.rotation
    const start = Date.now()
    const duration = 2200
    this.setData({ spinning: true, result: null })
    const frame = () => {
      const progress = Math.min((Date.now() - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      this.rotation = startRotation + alignment * eased
      this.drawWheel(this.rotation, true)
      if (progress < 1) {
        if (this.canvas?.requestAnimationFrame) this.canvas.requestAnimationFrame(frame)
        else setTimeout(frame, 16)
      } else {
        this.setData({ spinning: false, result: selected })
        this.drawWheel(this.rotation)
        wx.vibrateShort({ type: 'light' })
      }
    }
    frame()
  },
  toggleReducedMotion() {
    const reducedMotion = !this.data.reducedMotion
    this.setData({ reducedMotion })
    wx.setStorageSync(REDUCED_MOTION_KEY, reducedMotion)
  },
  useResult() {
    if (!this.data.result) return
    wx.setStorageSync(STORAGE_KEYS.recordDraft, wheelItemToDraft(this.data.result))
    wx.navigateTo({ url: '/pages/record-form/index?from=choice' })
  },
  editWheel() {
    if (!this.data.activeWheel) return
    wx.navigateTo({ url: `/pages/wheel-edit/index?id=${this.data.activeWheel.id}` })
  },
  async addWheel() {
    const wheel = await createWheel('我的新转盘')
    wx.navigateTo({ url: `/pages/wheel-edit/index?id=${wheel.id}` })
  },
})
