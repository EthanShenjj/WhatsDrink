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
      this.setData({ cellViews: views })
    },
  },
  methods: {
    onSelect(e: WechatMiniprogram.TouchEvent) {
      const key = String(e.currentTarget.dataset.key)
      const inMonth = Boolean(e.currentTarget.dataset.inmonth)
      if (!inMonth) return
      this.triggerEvent('select', { key })
    },
  },
})
