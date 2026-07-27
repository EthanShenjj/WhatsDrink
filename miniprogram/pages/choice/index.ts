import type { Wheel, WheelItem } from '../../domain/types'
import { createWheel, listWheels } from '../../services/repository'
import { STORAGE_KEYS } from '../../services/config'
import {
  chooseWheelItem,
  getWheelLabelRotation,
  validateWheelItems,
  wheelItemToDraft,
} from '../../utils/wheel'

const REDUCED_MOTION_KEY = 'whatsdrink-choice-reduced-motion'
const CHOICE_MODE_KEY = 'whatsdrink-choice-mode'
const WHEEL_COLORS = ['#D37556', '#EBC078', '#6D8CA4', '#A4B48F', '#CD937B', '#B29A7E']
const WHEEL_LABEL_COLORS = ['#FFF9EF', '#321F13', '#FFF9EF', '#321F13', '#321F13', '#321F13']
const CLAW_POOL_CUPS = Array.from({ length: 14 }, (_, index) => ({
  id: `claw-cup-${index + 1}`,
}))

type ChoiceMode = 'wheel' | 'claw'
type ClawPhase =
  | 'ready'
  | 'lowering'
  | 'gripping'
  | 'lifting'
  | 'releasing'
  | 'rolling'
  | 'won'

const clawStatusForPhase = (phase: ClawPhase, label = ''): string => {
  switch (phase) {
    case 'lowering':
      return '机械爪正在下落'
    case 'gripping':
      return '机械爪已经抓住一杯咖啡'
    case 'lifting':
      return '机械爪正在抬升咖啡'
    case 'releasing':
      return '机械爪正在把咖啡放入出杯通道'
    case 'rolling':
      return '咖啡正在从出口滚出'
    case 'won':
      return label ? `成功抓到${label}，可以继续记录` : '随机抓取完成'
    default:
      return '抓娃娃机已准备，可以随机抓取'
  }
}

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
    choiceMode: 'wheel' as ChoiceMode,
    clawWinningIndex: -1,
    clawPrize: null as WheelItem | null,
    clawBusy: false,
    clawPhase: 'ready' as ClawPhase,
    clawPoolCups: CLAW_POOL_CUPS,
    clawStatusText: clawStatusForPhase('ready'),
    clawAssetFailed: false,
  },
  clawTimers: [] as ReturnType<typeof setTimeout>[],
  rotation: 0,
  wheelCanvasSize: 0,
  onLoad() {
    const storedMode = wx.getStorageSync(CHOICE_MODE_KEY)
    this.setData({
      reducedMotion: Boolean(wx.getStorageSync(REDUCED_MOTION_KEY)),
      choiceMode: storedMode === 'claw' ? 'claw' : 'wheel',
    })
  },
  onShow() {
    this.getTabBar?.()?.setData({ selected: 2 })
    this.loadWheels()
  },
  onReady() {
    if (this.data.choiceMode === 'wheel') this.drawWheelWhenReady()
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
      clawWinningIndex: -1,
      clawPrize: null,
      clawBusy: false,
      clawPhase: 'ready',
      clawStatusText: clawStatusForPhase('ready'),
    })
    if (this.data.choiceMode === 'wheel') this.drawWheelWhenReady()
  },
  switchChoiceMode(event: WechatMiniprogram.TouchEvent) {
    if (this.data.spinning || this.data.clawBusy) return
    const nextMode = event.currentTarget.dataset.mode as ChoiceMode
    if (nextMode !== 'wheel' && nextMode !== 'claw') return
    this.setData({
      choiceMode: nextMode,
      result: null,
      validationMessage: validateWheelItems(this.data.activeWheel?.items || []) || '',
      clawWinningIndex: -1,
      clawPrize: null,
      clawBusy: false,
      clawPhase: 'ready',
      clawStatusText: clawStatusForPhase('ready'),
    })
    wx.setStorageSync(CHOICE_MODE_KEY, nextMode)
    if (nextMode === 'wheel') this.drawWheelWhenReady()
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
      clawWinningIndex: -1,
      clawPrize: null,
      clawBusy: false,
      clawPhase: 'ready',
      clawStatusText: clawStatusForPhase('ready'),
    })
    if (this.data.choiceMode === 'wheel') this.drawWheelWhenReady()
  },
  drawWheelWhenReady() {
    wx.nextTick(() => {
      wx.createSelectorQuery()
        .in(this)
        .select('#wheelCanvas')
        .boundingClientRect((rect) => {
          if (!rect || Array.isArray(rect) || !rect.width) return
          this.wheelCanvasSize = rect.width
          this.drawWheel(undefined, false, rect.width)
        })
        .exec()
    })
  },
  drawWheel(rotation?: number, labelsFollowWheel = false, measuredSize?: number) {
    const items = this.data.activeWheel?.items || []
    const windowInfo = wx.getWindowInfo()
    const wheelRpx = windowInfo.windowHeight <= 760 ? 480 : 600
    const size =
      measuredSize || this.wheelCanvasSize || windowInfo.windowWidth * (wheelRpx / 750)
    const center = size / 2
    const radius = center - 10
    const currentRotation = rotation ?? this.rotation
    const context = wx.createCanvasContext('wheelCanvas', this)

    context.clearRect(0, 0, size, size)
    if (!items.length) {
      context.draw()
      return
    }

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
      context.setFillStyle(WHEEL_COLORS[index % WHEEL_COLORS.length])
      context.fill()

      context.save()
      const middle = start + sector / 2
      context.rotate(middle)
      context.translate(radius * 0.6, 0)
      context.rotate(getWheelLabelRotation(middle, currentRotation, labelsFollowWheel))
      context.setFillStyle(WHEEL_LABEL_COLORS[index % WHEEL_LABEL_COLORS.length])
      context.setFontSize(items.length > 10 ? 11 : 13)
      context.setTextAlign('center')
      context.setTextBaseline('middle')
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
    context.setFillStyle('#321F13')
    context.fill()
    context.restore()

    context.beginPath()
    context.moveTo(center, 4)
    context.lineTo(center - 14, 34)
    context.lineTo(center + 14, 34)
    context.closePath()
    context.setFillStyle('#321F13')
    context.fill()
    context.draw()
  },
  grabPrize() {
    if (this.data.clawBusy || !this.data.activeWheel) return
    const validationMessage = validateWheelItems(this.data.activeWheel.items)
    if (validationMessage) {
      this.setData({ validationMessage })
      wx.showToast({ title: validationMessage, icon: 'none' })
      return
    }
    const selected = chooseWheelItem(this.data.activeWheel.items)
    const clawWinningIndex = Math.floor(Math.random() * this.data.clawPoolCups.length)
    if (this.data.reducedMotion) {
      this.setData({
        clawPhase: 'won',
        clawWinningIndex,
        clawPrize: selected,
        clawBusy: false,
        result: selected,
        clawStatusText: clawStatusForPhase('won', selected.label),
      })
      return
    }

    this.clearClawTimers()
    this.setData({
      clawPhase: 'lowering',
      clawWinningIndex,
      clawPrize: selected,
      clawBusy: true,
      result: null,
      clawStatusText: clawStatusForPhase('lowering'),
    })
    this.queueClawPhase('gripping', 650)
    this.queueClawPhase('lifting', 1100)
    this.queueClawPhase('releasing', 1750)
    this.queueClawPhase('rolling', 2350)
    const completionTimer = setTimeout(() => {
      this.setData({
        clawPhase: 'won',
        clawBusy: false,
        result: selected,
        clawStatusText: clawStatusForPhase('won', selected.label),
      })
    }, 3250)
    this.clawTimers.push(completionTimer)
  },
  queueClawPhase(phase: ClawPhase, delay: number) {
    const timer = setTimeout(() => {
      this.setData({
        clawPhase: phase,
        clawStatusText: clawStatusForPhase(phase),
      })
    }, delay)
    this.clawTimers.push(timer)
  },
  clearClawTimers() {
    this.clawTimers.forEach((timer) => clearTimeout(timer))
    this.clawTimers = []
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
        setTimeout(frame, 16)
      } else {
        this.setData({ spinning: false, result: selected })
        this.drawWheel(this.rotation)
        wx.vibrateShort({ type: 'light' })
      }
    }
    frame()
  },
  handleWheelPrimaryAction() {
    if (this.data.result) {
      this.useResult()
      return
    }
    this.spin()
  },
  handleClawPrimaryAction() {
    if (this.data.result && !this.data.clawBusy) {
      this.useResult()
      return
    }
    this.grabPrize()
  },
  handleClawAssetError() {
    this.setData({ clawAssetFailed: true })
  },
  toggleReducedMotion() {
    if (this.data.spinning || this.data.clawBusy) return
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
  onUnload() {
    this.clearClawTimers()
  },
})
