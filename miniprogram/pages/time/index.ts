import type { Footprint, MonthCell, MemoryDrop, GrowthSnapshot } from '../../domain/types'
import { listFootprints } from '../../services/repository'
import { groupByDate, sortByVisitDate, buildMemoryDrops } from '../../utils/footprint'
import {
  buildMonthGrid,
  todayKey,
  formatMonthLabel,
  formatVisitDate,
  weekdays,
} from '../../utils/date'
import { computeGrowthSnapshot } from '../../utils/growth'

interface PageData {
  viewMode: 'calendar' | 'timeline'
  year: number
  month: number
  cells: MonthCell[]
  footprints: Footprint[]
  todayKey: string
  selectedKey: string
  selectedDateLabel: string
  selectedFootprints: Footprint[]
  monthLabel: string
  weekdayList: string[]
  monthFootprintCount: number
  timelineGroups: Array<{
    key: string
    label: string
    footprints: Footprint[]
  }>
  memoryDrops: MemoryDrop[]
  loading: boolean
  empty: boolean
  growth: GrowthSnapshot | null
}

const app = getApp<IAppOption>()
const labelForKey = (key: string, today: string): string =>
  key === today ? '今天' : formatVisitDate(key)

Page<PageData, WechatMiniprogram.IAnyObject>({
  data: {
    viewMode: 'calendar',
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    cells: [],
    footprints: [],
    todayKey: todayKey(),
    selectedKey: todayKey(),
    selectedDateLabel: '今天',
    selectedFootprints: [],
    monthLabel: '',
    weekdayList: weekdays,
    monthFootprintCount: 0,
    timelineGroups: [],
    memoryDrops: [],
    loading: true,
    empty: false,
    growth: null,
  },

  onLoad() {
    this.setData({ monthLabel: formatMonthLabel(this.data.year, this.data.month) })
  },

  onShow() {
    const tabBar = this.getTabBar?.()
    if (tabBar) tabBar.setData({ selected: 1 })
    this.setData({ todayKey: todayKey() })
    this.loadFootprints()
  },

  async loadFootprints() {
    const cachedAt = app.globalData.footprintsCachedAt || 0
    const isStale = Date.now() - cachedAt > 60_000
    let list = app.globalData.footprints || []
    if (!list.length || isStale) {
      try {
        list = await listFootprints()
        app.globalData.footprints = list
        app.globalData.footprintsCachedAt = Date.now()
      } catch (err) {
        console.warn('[time] load failed', err)
        this.setData({ loading: false, empty: true })
        return
      }
    }
    this.applyFootprints(list)
  },

  applyFootprints(list: Footprint[]) {
    const { year, month, selectedKey } = this.data
    const today = new Date()
    const visited = list.filter((fp) => fp.status === 'visited' && Boolean(fp.visitDate))
    const cells = buildMonthGrid(year, month, visited, today)
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`
    const monthFootprints = visited.filter((fp) => fp.visitDate?.startsWith(monthPrefix))
    const grouped = groupByDate(visited)
    const selectedFootprints = sortByVisitDate(grouped.get(selectedKey) || [])
    const timelineGroups = [...grouped.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([key, footprints]) => ({
        key,
        label: labelForKey(key, this.data.todayKey),
        footprints: sortByVisitDate(footprints),
      }))
    this.setData({
      cells,
      footprints: visited,
      selectedFootprints,
      selectedDateLabel: labelForKey(selectedKey, this.data.todayKey),
      monthFootprintCount: monthFootprints.length,
      timelineGroups,
      memoryDrops: buildMemoryDrops(visited, this.data.todayKey),
      loading: false,
      empty: visited.length === 0,
      growth: computeGrowthSnapshot(list, app.globalData.profile),
    })
  },

  onViewModeTap(e: WechatMiniprogram.TouchEvent) {
    const mode = e.currentTarget.dataset.mode as 'calendar' | 'timeline'
    if (mode !== 'calendar' && mode !== 'timeline') return
    this.setData({ viewMode: mode })
  },

  selectedKeyForMonth(year: number, month: number): string {
    const now = new Date()
    if (year === now.getFullYear() && month === now.getMonth()) return todayKey()
    return `${year}-${String(month + 1).padStart(2, '0')}-01`
  },

  onPrevMonth() {
    let { year, month } = this.data
    if (month === 0) {
      year -= 1
      month = 11
    } else {
      month -= 1
    }
    this.setData({
      year,
      month,
      selectedKey: this.selectedKeyForMonth(year, month),
      monthLabel: formatMonthLabel(year, month),
    })
    this.applyFootprints(this.data.footprints)
  },

  onNextMonth() {
    let { year, month } = this.data
    if (month === 11) {
      year += 1
      month = 0
    } else {
      month += 1
    }
    this.setData({
      year,
      month,
      selectedKey: this.selectedKeyForMonth(year, month),
      monthLabel: formatMonthLabel(year, month),
    })
    this.applyFootprints(this.data.footprints)
  },

  onTodayJump() {
    const now = new Date()
    const today = todayKey()
    this.setData({
      year: now.getFullYear(),
      month: now.getMonth(),
      selectedKey: today,
      monthLabel: formatMonthLabel(now.getFullYear(), now.getMonth()),
    })
    this.applyFootprints(this.data.footprints)
  },

  onCellSelect(e: WechatMiniprogram.CustomEvent<{ key: string }>) {
    const key = e.detail.key
    const grouped = groupByDate(this.data.footprints)
    const list = sortByVisitDate(grouped.get(key) || [])
    this.setData({
      selectedKey: key,
      selectedFootprints: list,
      selectedDateLabel: labelForKey(key, this.data.todayKey),
    })
  },

  onFootprintTap(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const id = e.detail.id
    if (!id) return
    wx.navigateTo({ url: `/pages/footprint-detail/index?id=${id}` })
  },

  onAddFootprint() {
    wx.navigateTo({ url: '/pages/footprint-form/index' })
  },

  onCapsuleTap() {
    wx.navigateTo({ url: '/pages/time-capsule/index' })
  },

  onGrowthTap() {
    wx.navigateTo({ url: '/pages/growth/index' })
  },

  onMemoryDropTap(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (id) wx.navigateTo({ url: `/pages/footprint-detail/index?id=${id}` })
  },
})
