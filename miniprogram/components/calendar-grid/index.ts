import { weekdays } from '../../utils/date'
import { moodEmoji } from '../../data/options'

interface CellView {
  key: string
  day: number
  inMonth: boolean
  isToday: boolean
  footprintCount: number
  previewPhoto: string
  previewMood: string
  moodEmoji: string
  hasFootprint: boolean
  isSelected?: boolean
}

type GridInstance = WechatMiniprogram.Component.TrivialInstance & {
  _lastYear?: number
  _lastMonth?: number
  _animTick?: number
}

Component({
  properties: {
    cells: {
      type: Array,
      value: [] as CellView[],
    },
    year: {
      type: Number,
      value: 0,
    },
    month: {
      type: Number,
      value: 0,
    },
    selectedKey: {
      type: String,
      value: '',
    },
  },
  data: {
    weekdays,
    cellViews: [] as CellView[],
    animClass: '',
  },
  observers: {
    'cells,selectedKey'(cells: CellView[], selectedKey: string) {
      const views = (cells || []).map((c) => ({
        key: c.key,
        day: c.day,
        inMonth: c.inMonth,
        isToday: c.isToday,
        footprintCount: c.footprintCount || 0,
        previewPhoto: c.previewPhoto || '',
        previewMood: c.previewMood || '',
        moodEmoji: c.previewMood ? moodEmoji(c.previewMood) : '',
        hasFootprint: (c.footprintCount || 0) > 0,
        isSelected: c.key === selectedKey,
      }))
      // 补位格留白后，裁掉月末之后的整行空格，避免出现全空的一周
      const lastInMonth = views.map((v) => v.inMonth).lastIndexOf(true)
      if (lastInMonth >= 0) {
        const trimmed = Math.ceil((lastInMonth + 1) / 7) * 7
        if (trimmed < views.length) views.length = trimmed
      }
      this.setData({ cellViews: views })
    },
    'year,month'(year: number, month: number) {
      const self = this as GridInstance
      if (self._lastYear === undefined || self._lastMonth === undefined) {
        self._lastYear = year
        self._lastMonth = month
        self._animTick = 0
        return
      }
      if (year === self._lastYear && month === self._lastMonth) return
      const dir = year > self._lastYear || (year === self._lastYear && month > self._lastMonth) ? 'next' : 'prev'
      self._lastYear = year
      self._lastMonth = month
      self._animTick = (self._animTick || 0) + 1
      // tick 在两个同款动画类之间交替，保证连续切换时动画能重新触发
      this.setData({ animClass: `cal-anim-${dir}-${self._animTick % 2}` })
    },
  },
  methods: {
    onSelect(e: WechatMiniprogram.TouchEvent) {
      const key = String(e.currentTarget.dataset.key || '')
      if (!key) return
      this.triggerEvent('select', {
        key,
        inMonth: Boolean(e.currentTarget.dataset.inmonth),
      })
    },
  },
})
