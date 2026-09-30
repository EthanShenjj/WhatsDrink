import type { Footprint, MonthCell, MemoryDrop, GrowthSnapshot, UserProfile } from '../../domain/types'
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

interface TimelineGroup {
  key: string
  label: string
  footprints: Footprint[]
}

interface PageData {
  viewMode: 'calendar' | 'timeline'
  year: number
  month: number
  cells: MonthCell[]
  todayKey: string
  selectedKey: string
  selectedDateLabel: string
  selectedFootprints: Footprint[]
  monthLabel: string
  weekdayList: string[]
  monthFootprintCount: number
  timelineGroups: TimelineGroup[]
  memoryDrops: MemoryDrop[]
  memoryImgLoaded: Record<string, boolean>
  loading: boolean
  empty: boolean
  growth: GrowthSnapshot | null
}

const app = getApp<IAppOption>()
const FOOTPRINTS_MAX_AGE_MS = 60_000
// 时间线分组按页追加，保证首屏节点数与全部记录量解耦
const TIMELINE_GROUPS_PER_PAGE = 10

const labelForKey = (key: string, today: string): string =>
  key === today ? '今天' : formatVisitDate(key)

Page<PageData, WechatMiniprogram.IAnyObject>({
  // 实例态：数据源引用、按日分组与时间线分页游标（自定义字段为 any，
  // 实例数组上的回调参数需显式标注类型）
  lastFootprintsSource: null as Footprint[] | null,
  lastRenderedProfile: null as UserProfile | null,
  lastRenderedToday: '',
  visitedFootprints: [] as Footprint[],
  groupedByDate: new Map<string, Footprint[]>(),
  allTimelineGroups: [] as TimelineGroup[],
  timelineGroupPage: 0,

  data: {
    viewMode: 'calendar',
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    cells: [],
    todayKey: todayKey(),
    selectedKey: todayKey(),
    selectedDateLabel: '今天',
    selectedFootprints: [],
    monthLabel: '',
    weekdayList: weekdays,
    monthFootprintCount: 0,
    timelineGroups: [],
    memoryDrops: [],
    memoryImgLoaded: {},
    loading: true,
    empty: false,
    growth: null,
  },

  onLoad() {
    this.setData({ monthLabel: formatMonthLabel(this.data.year, this.data.month) })
  },

  onShow() {
    const tabBar = this.getTabBar?.()
    if (tabBar && (tabBar.data as { selected?: number }).selected !== 1) tabBar.setData({ selected: 1 })
    const today = todayKey()
    if (today !== this.data.todayKey) this.setData({ todayKey: today })
    this.loadFootprints()
  },

  async loadFootprints() {
    let list: Footprint[]
    try {
      list = await listFootprints({ maxAgeMs: FOOTPRINTS_MAX_AGE_MS })
    } catch (err) {
      console.warn('[time] load failed', err)
      this.setData({ loading: false, empty: true })
      return
    }
    if (list === this.lastFootprintsSource
      && this.lastRenderedProfile === (app.globalData.profile || null)
      && this.lastRenderedToday === this.data.todayKey) return
    this.applyFootprints(list)
    this.lastFootprintsSource = list
    this.lastRenderedProfile = app.globalData.profile || null
    this.lastRenderedToday = this.data.todayKey
  },

  applyFootprints(list: Footprint[]) {
    const { year, month, selectedKey } = this.data
    const today = new Date()
    const visited = list.filter((fp) => fp.status === 'visited' && Boolean(fp.visitDate))
    this.visitedFootprints = visited
    this.groupedByDate = groupByDate(visited)
    const allTimelineGroups = [...this.groupedByDate.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([key, footprints]) => ({
        key,
        label: labelForKey(key, this.data.todayKey),
        footprints: sortByVisitDate(footprints),
      }))
    this.allTimelineGroups = allTimelineGroups
    this.timelineGroupPage = 1
    this.setData({
      cells: buildMonthGrid(year, month, visited, today),
      selectedFootprints: sortByVisitDate(this.groupedByDate.get(selectedKey) || []),
      selectedDateLabel: labelForKey(selectedKey, this.data.todayKey),
      monthFootprintCount: this.monthFootprintCount(year, month),
      timelineGroups: allTimelineGroups.slice(0, TIMELINE_GROUPS_PER_PAGE),
      memoryDrops: buildMemoryDrops(visited, this.data.todayKey),
      loading: false,
      empty: visited.length === 0,
      growth: computeGrowthSnapshot(list, app.globalData.profile),
    })
  },

  monthFootprintCount(year: number, month: number): number {
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`
    return this.visitedFootprints.filter((fp: Footprint) => fp.visitDate?.startsWith(monthPrefix)).length
  },

  /** 翻月 / 跳转今天 / 跨月选中：只重算当前视图相关字段 */
  refreshMonthView() {
    const { year, month, selectedKey } = this.data
    this.setData({
      cells: buildMonthGrid(year, month, this.visitedFootprints, new Date()),
      selectedFootprints: sortByVisitDate(this.groupedByDate.get(selectedKey) || []),
      selectedDateLabel: labelForKey(selectedKey, this.data.todayKey),
      monthFootprintCount: this.monthFootprintCount(year, month),
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

  goToMonth(delta: number) {
    let { year, month } = this.data
    month += delta
    if (month < 0) {
      year -= 1
      month = 11
    } else if (month > 11) {
      year += 1
      month = 0
    }
    this.setData({
      year,
      month,
      selectedKey: this.selectedKeyForMonth(year, month),
      monthLabel: formatMonthLabel(year, month),
    })
    this.refreshMonthView()
  },

  onTouchStart(e: WechatMiniprogram.TouchEvent) {
    const touch = e.touches[0]
    this._swipeStartX = touch.clientX
    this._swipeStartY = touch.clientY
  },

  onTouchEnd(e: WechatMiniprogram.TouchEvent) {
    const touch = e.changedTouches[0]
    if (!touch || this._swipeStartX === undefined) return
    const dx = touch.clientX - this._swipeStartX
    const dy = touch.clientY - this._swipeStartY
    this._swipeStartX = undefined
    this._swipeStartY = undefined
    // 水平位移足够大且明显强于纵向位移才判定为翻月滑动，避免干扰页面纵向滚动
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    this.goToMonth(dx < 0 ? 1 : -1)
  },

  onPrevMonth() {
    this.goToMonth(-1)
  },

  onNextMonth() {
    this.goToMonth(1)
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
    this.refreshMonthView()
  },

  onCellSelect(e: WechatMiniprogram.CustomEvent<{ key: string; inMonth?: boolean }>) {
    const key = e.detail.key
    // 点击了相邻月份的补位日期：先翻到对应月份再选中
    const viewPrefix = `${this.data.year}-${String(this.data.month + 1).padStart(2, '0')}`
    if (key.slice(0, 7) !== viewPrefix) {
      const [year, month] = key.split('-').map(Number)
      this.setData({
        year,
        month: month - 1,
        monthLabel: formatMonthLabel(year, month - 1),
        selectedKey: key,
      })
      this.refreshMonthView()
      return
    }
    this.setData({
      selectedKey: key,
      selectedFootprints: sortByVisitDate(this.groupedByDate.get(key) || []),
      selectedDateLabel: labelForKey(key, this.data.todayKey),
    })
  },

  onReachBottom() {
    if (this.data.viewMode !== 'timeline') return
    const start = this.timelineGroupPage * TIMELINE_GROUPS_PER_PAGE
    if (start >= this.allTimelineGroups.length) return
    this.timelineGroupPage += 1
    const addition = this.allTimelineGroups.slice(
      start,
      this.timelineGroupPage * TIMELINE_GROUPS_PER_PAGE,
    )
    this.setData({ timelineGroups: this.data.timelineGroups.concat(addition) })
  },

  onFootprintTap(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const id = e.detail.id
    if (!id) return
    wx.navigateTo({ url: `/pages/footprint-detail/index?id=${id}` })
  },

  onAddFootprint() {
    // 带上当前选中的日期，补记历史足迹时表单不必再手动改日期
    wx.navigateTo({ url: `/pages/footprint-form/index?date=${this.data.selectedKey}` })
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

  onMemoryImgLoad(e: WechatMiniprogram.CustomEvent<{ width: number; height: number }>) {
    const id = String(e.currentTarget.dataset.id || '')
    if (id) this.setData({ [`memoryImgLoaded.${id}`]: true })
  },
})
