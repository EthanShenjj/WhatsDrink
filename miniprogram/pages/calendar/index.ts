import type { DrinkRecord } from '../../domain/types'
import { listRecords } from '../../services/repository'
import { buildMonthGrid, dateKey, summarizeRecords, timeText } from '../../utils/date'

const dateLabel = (key: string): string => {
  const [year, month, day] = key.split('-').map(Number)
  return `${year}年${month}月${day}日`
}

const dateHeading = (key: string): string => {
  const [year, month, day] = key.split('-').map(Number)
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const weekday = weekdays[new Date(year, month - 1, day).getDay()]
  return `${month}月${day}日，${weekday}`
}

type StampTone = 'coffee' | 'milk-tea' | 'mixed' | ''

type CalendarCellView = ReturnType<typeof buildMonthGrid>[number] & {
  hasRecord: boolean
  recordCount: number
  stampTone: StampTone
}

interface SelectedRecordView extends DrinkRecord {
  timeText: string
  calorieText: string
  fallbackImage: string
}

Page({
  data: {
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    monthText: '',
    cells: [] as CalendarCellView[],
    selectedKey: dateKey(new Date()),
    selectedDateText: dateLabel(dateKey(new Date())),
    selectedDateHeading: dateHeading(dateKey(new Date())),
    selectedRecords: [] as SelectedRecordView[],
    selectedCount: 0,
    selectedCalories: 0,
    records: [] as DrinkRecord[],
    weekdayLabels: ['一', '二', '三', '四', '五', '六', '日'],
  },
  onShow() {
    this.getTabBar?.()?.setData({ selected: 1 })
    this.loadData()
  },
  async loadData() {
    const records = await listRecords()
    this.setData({ records })
    this.refreshCalendar()
  },
  refreshCalendar() {
    const recordsByKey = this.data.records.reduce<Record<string, DrinkRecord[]>>((groups, record) => {
      const key = dateKey(record.consumedAt)
      groups[key] = groups[key] || []
      groups[key].push(record)
      return groups
    }, {})
    let monthCells = buildMonthGrid(this.data.year, this.data.month)
    if (monthCells.slice(-7).every((cell) => !cell.inMonth)) {
      monthCells = monthCells.slice(0, -7)
    }
    const cells = monthCells.map<CalendarCellView>((cell) => {
      const dayRecords = recordsByKey[cell.key] || []
      const recordCount = dayRecords.length
      const categories = new Set(dayRecords.map((record) => record.category))
      const stampTone: StampTone =
        categories.size > 1
          ? 'mixed'
          : categories.has('milk_tea')
            ? 'milk-tea'
            : categories.has('coffee')
              ? 'coffee'
              : ''
      return {
        ...cell,
        hasRecord: recordCount > 0,
        recordCount,
        stampTone,
      }
    })
    this.setData({
      cells,
      monthText: `${this.data.year}年${this.data.month + 1}月`,
    })
    this.selectKey(this.data.selectedKey)
  },
  previousMonth() {
    const date = new Date(this.data.year, this.data.month - 1, 1)
    this.setData({ year: date.getFullYear(), month: date.getMonth(), selectedKey: dateKey(date) })
    this.refreshCalendar()
  },
  nextMonth() {
    const date = new Date(this.data.year, this.data.month + 1, 1)
    this.setData({ year: date.getFullYear(), month: date.getMonth(), selectedKey: dateKey(date) })
    this.refreshCalendar()
  },
  selectDate(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key)
    const cell = this.data.cells.find((item) => item.key === key)
    if (!cell?.inMonth) return
    this.setData({
      year: cell.date.getFullYear(),
      month: cell.date.getMonth(),
      selectedKey: key,
    })
    this.refreshCalendar()
  },
  selectKey(key: string) {
    const records = this.data.records
      .filter((record) => dateKey(record.consumedAt) === key)
      .map((record) => ({
        ...record,
        timeText: timeText(record.consumedAt),
        calorieText:
          typeof record.calorieKcal === 'number' ? `${record.calorieKcal} 千卡` : '热量未填写',
        fallbackImage:
          record.category === 'coffee' ? '/assets/coconut-latte.jpg' : '/assets/milk-tea.jpg',
      }))
    const summary = summarizeRecords(records)
    this.setData({
      selectedRecords: records,
      selectedCount: summary.count,
      selectedCalories: summary.knownCalories,
      selectedDateText: dateLabel(key),
      selectedDateHeading: dateHeading(key),
    })
  },
  editRecord(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/record-form/index?id=${event.currentTarget.dataset.id}` })
  },
  addRecord() {
    wx.navigateTo({ url: `/pages/record-form/index?date=${this.data.selectedKey}` })
  },
})
