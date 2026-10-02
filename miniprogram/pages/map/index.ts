import type {
  Footprint,
  MapMode,
  MapSettings,
  FilterState,
  LightingStats,
  ClusterMarker,
  CityGrowth,
  GrowthOverview,
} from '../../domain/types'
import {
  listFootprints,
  loginForAccess,
  getLocalProfile,
  hasCloudAccess,
  getMapSettings,
  saveMapSettings,
} from '../../services/repository'
import { clusterFootprints, fitBounds, footprintsForMapMode, markerPhotoForZoom } from '../../utils/map'
import {
  buildCheckinRoute,
  findNearbyCheckinCandidate,
} from '../../utils/checkin'
import type { CheckinCandidate } from '../../utils/checkin'
import { matchesFilter, computeLighting, computeCityGrowth, placeKey, usedMoods, usedCategories } from '../../utils/footprint'
import { formatVisitDate, todayKey } from '../../utils/date'
import { moodEmoji } from '../../data/options'
import { MAP_STYLE_IDS, MAP_STYLE_SUBKEY } from '../../services/config'
import { computeGrowthOverview } from '../../utils/growth'
import { installUpdatePerformanceLogger, recordInteraction } from '../../utils/performance'

interface MapMarker {
  id: number
  latitude: number
  longitude: number
  title: string
  width: number
  height: number
  iconPath: string
  photo?: string
  callout?: {
    content: string
    color: string
    fontSize: number
    bgColor: string
    padding: number
    borderRadius: number
    display: 'BYCLICK' | 'ALWAYS'
  }
  customCallout?: {
    anchorX: number
    anchorY: number
    display: 'BYCLICK' | 'ALWAYS'
  }
  markerId?: string
  isCluster?: boolean
  count?: number
}

interface FilterChip {
  key: keyof FilterState
  label: string
}

interface UnplacedFootprintItem {
  id: string
  poiName: string
  photo: string
  dateLabel: string
  statusLabel: string
  isWishlist: boolean
}

interface GrowthCircle {
  latitude: number
  longitude: number
  radius: number
  color: string
  fillColor: string
  strokeWidth: number
}

/**
 * WXML 只渲染界面控件所需的轻量字段；完整足迹、过滤结果与标记索引
 * 都放在页面实例上，避免每次 setData 把大对象整份传到渲染层。
 */
interface PageData {
  mode: MapMode
  markers: MapMarker[]
  unplacedFootprints: UnplacedFootprintItem[]
  filterVisible: boolean
  currentFilter: FilterState
  moods: string[]
  categories: string[]
  settings: MapSettings
  mapStyleSubkey: string
  mapLayerStyle: number
  clusterEnabled: boolean
  loading: boolean
  empty: boolean
  modeEmpty: boolean
  modeEmptyTitle: string
  modeEmptyDescription: string
  activeFilterCount: number
  activeFilterChips: FilterChip[]
  hasLocationAuth: boolean
  selectedFootprint: Footprint | null
  detailVisible: boolean
  detailClosing: boolean
  center: { latitude: number; longitude: number }
  scale: number
  lighting: LightingStats | null
  growthCities: CityGrowth[]
  growthCircles: GrowthCircle[]
  checkinVisible: boolean
  checkinClosing: boolean
  checkinCandidate: CheckinCandidate | null
  checkinDistance: number
  statusBarHeight: number
  tabReady: boolean
  growth: GrowthOverview | null
}

interface MarkerIndex {
  markers: MapMarker[]
  markerIdMap: Record<number, string>
  clusterMarkers: Record<number, ClusterMarker>
}

interface ModeView {
  modeList: Footprint[]
  fields: {
    modeEmpty: boolean
    unplacedFootprints: UnplacedFootprintItem[]
    modeEmptyTitle: string
    modeEmptyDescription: string
  }
}

const DEFAULT_CENTER = { latitude: 35.0, longitude: 105.0 }
const DEFAULT_SCALE = 4
// 与 repository 的共享缓存配合：热切回地图 60 秒内不重新请求足迹
const FOOTPRINTS_MAX_AGE_MS = 60_000
const MAP_MODE_STORAGE_KEY = 'sgj:map-mode'
const PENDING_MAP_ACTION_STORAGE_KEY = 'sgj:pending-map-action'

const app = getApp<IAppOption>()
let mapContext: WechatMiniprogram.MapContext | undefined
const BRAND_MARKER_ICON = '/assets/icons/map-marker.svg'
const MARKER_ICON_BY_COLOR: Record<string, string> = {
  '#5b6cff': BRAND_MARKER_ICON,
  '#ff8f84': '/assets/icons/map-marker-caramel.png',
  '#42c8df': '/assets/icons/map-marker-blue.png',
  '#f4b93f': '/assets/icons/map-marker-amber.png',
  '#f16fa8': '/assets/icons/map-marker-red.png',
  '#f39a79': '/assets/icons/map-marker-caramel.png',
  '#86aa86': '/assets/icons/map-marker-moss.png',
  '#f1b94c': '/assets/icons/map-marker-amber.png',
  '#6d8ca4': '/assets/icons/map-marker-blue.png',
  '#c0524a': '/assets/icons/map-marker-red.png',
  // Migrate records saved with the former purple marker to the current brand blue.
  '#8b6f9e': BRAND_MARKER_ICON,
  '#d4915c': '/assets/icons/map-marker-caramel.png',
}

const buildMarker = (
  fp: Footprint,
  id: number,
  mode: MapMode,
  settings: MapSettings,
  zoom: number,
  visitCount = 1,
): MapMarker => {
  const isWishlist = mode === 'wishlist' || fp.status !== 'visited'
  const photo = markerPhotoForZoom(fp, zoom)
  const emoji = fp.status === 'fulfilled' ? '🌸' : isWishlist ? '🌱' : fp.markerStyle?.emoji || moodEmoji(fp.mood) || '📍'
  const label = settings.markerStyle === 'emoji'
    ? `${emoji}${zoom >= 12 ? ` ${fp.poiName}` : ''}`
    : settings.markerStyle === 'label' && zoom >= 12
      ? fp.poiName
      : `${emoji} ${fp.poiName}${visitCount > 1 ? ` · ${visitCount}次` : ''}`
  return {
    id,
    latitude: fp.lat as number,
    longitude: fp.lng as number,
    title: fp.poiName,
    width: photo ? 24 : 32,
    height: photo ? 30 : 40,
    iconPath: MARKER_ICON_BY_COLOR[(fp.status === 'fulfilled' ? '#F4B93F' : fp.markerStyle?.color || (isWishlist ? '#F4B93F' : '#5B6CFF')).toLowerCase()]
      || BRAND_MARKER_ICON,
    photo: photo || undefined,
    ...(photo
      ? {
          customCallout: {
            anchorX: 0,
            anchorY: 0,
            display: 'ALWAYS' as const,
          },
        }
      : {
          callout: {
            content: label,
            color: settings.theme === 'night' ? '#F7F8FF' : '#17182B',
            fontSize: 12,
            bgColor: settings.theme === 'night' ? '#17182B' : '#FFFFFF',
            padding: 8,
            borderRadius: 12,
            display: settings.markerStyle === 'label' && zoom >= 12 ? 'ALWAYS' as const : 'BYCLICK' as const,
          },
        }),
    markerId: fp.id,
    isCluster: false,
  }
}

const buildUnplacedFootprintItem = (fp: Footprint): UnplacedFootprintItem => ({
  id: fp.id,
  poiName: fp.poiName,
  photo: fp.photoThumbs?.[0] || fp.photos?.[0] || '',
  dateLabel: formatVisitDate(fp.visitDate),
  statusLabel: fp.status === 'wishlist' ? '想去' : fp.status === 'fulfilled' ? '已实现' : '已到访',
  isWishlist: fp.status !== 'visited',
})

const buildClusterMarker = (
  cluster: ClusterMarker,
  id: number,
  mode: MapMode,
): MapMarker => {
  const accent = mode === 'wishlist' ? '#F4B93F' : '#5B6CFF'
  return {
    id,
    latitude: cluster.latitude,
    longitude: cluster.longitude,
    title: `${cluster.count} 个足迹`,
    width: 48,
    height: 48,
    iconPath: '/assets/icons/location-marker.png',
    callout: {
      content: `${cluster.count}`,
      color: '#FFFFFF',
      fontSize: 13,
      bgColor: accent,
      padding: 10,
      borderRadius: 24,
      display: 'ALWAYS',
    },
    isCluster: true,
    count: cluster.count,
  }
}

const filterChips = (filter: FilterState): FilterChip[] => {
  const chips: FilterChip[] = []
  if (filter.dateStart || filter.dateEnd) {
    chips.push({
      key: 'dateStart',
      label: `${filter.dateStart || '不限'} 至 ${filter.dateEnd || '今天'}`,
    })
  }
  if (filter.country) chips.push({ key: 'country', label: filter.country })
  if (filter.province) chips.push({ key: 'province', label: filter.province })
  if (filter.city) chips.push({ key: 'city', label: filter.city })
  if (filter.category) chips.push({ key: 'category', label: filter.category })
  if (filter.mood) chips.push({ key: 'mood', label: filter.mood })
  return chips
}

const modeCopy = (
  mode: MapMode,
): { title: string; description: string } => {
  if (mode === 'wishlist') {
    return { title: '还没有想去的地方', description: '先收藏一处期待，未来到访时再把它变成回忆' }
  }
  if (mode === 'lighting') {
    return { title: '地图还没有被点亮', description: '每一条去过的足迹，都会点亮一座城市' }
  }
  return { title: '还没有足迹', description: '从街角到世界，留下你的第一枚拾光' }
}

const scaleToZoom = (scale: number): number => {
  if (scale <= 4) return 4
  if (scale <= 6) return 6
  if (scale <= 9) return 9
  if (scale <= 12) return 12
  if (scale <= 15) return 15
  return 17
}

const buildGrowthCircles = (growthCities: CityGrowth[]): GrowthCircle[] =>
  growthCities
    .filter((city) => typeof city.latitude === 'number' && typeof city.longitude === 'number')
    .map((city) => ({
      latitude: city.latitude!,
      longitude: city.longitude!,
      radius: city.level === 3 ? 30000 : city.level === 2 ? 18000 : 8000,
      color: city.level === 3 ? '#3E47C899' : '#5B6CFF80',
      fillColor: city.level === 3 ? '#5B6CFF66' : city.level === 2 ? '#5B6CFF44' : '#5B6CFF2E',
      strokeWidth: city.level === 3 ? 3 : 1,
    }))

Page<PageData, WechatMiniprogram.IAnyObject>({
  detailCloseTimer: null,
  checkinCloseTimer: null,

  // ─── 实例态：不进入渲染层的大对象与视图缓存（自定义字段受 IAnyObject 约束为
  // any，实例数组上的回调参数需显式标注类型）───
  allFootprints: [] as Footprint[],
  footprintsById: {} as Record<string, Footprint>,
  filteredFootprints: [] as Footprint[],
  mapScale: DEFAULT_SCALE,
  zoomTier: scaleToZoom(DEFAULT_SCALE),
  dataVersion: 0,
  markerCacheKey: '',
  markerCache: null as MarkerIndex | null,
  isVisible: false,
  mapReady: false,
  loadSequence: 0,
  pendingFootprints: null as Footprint[] | null,

  data: {
    mode: 'visited',
    markers: [],
    unplacedFootprints: [],
    filterVisible: false,
    currentFilter: {},
    moods: [],
    categories: [],
    settings: getMapSettings(),
    mapStyleSubkey: MAP_STYLE_SUBKEY,
    mapLayerStyle: MAP_STYLE_IDS[getMapSettings().theme],
    clusterEnabled: getMapSettings().clusterEnabled,
    loading: true,
    empty: false,
    modeEmpty: false,
    modeEmptyTitle: '还没有足迹',
    modeEmptyDescription: '去一个地方，留下你的第一枚拾光',
    activeFilterCount: 0,
    activeFilterChips: [],
    hasLocationAuth: false,
    selectedFootprint: null,
    detailVisible: false,
    detailClosing: false,
    center: DEFAULT_CENTER,
    scale: DEFAULT_SCALE,
    lighting: null,
    growthCities: [],
    growthCircles: [],
    checkinVisible: false,
    checkinClosing: false,
    checkinCandidate: null,
    checkinDistance: 0,
    statusBarHeight: 20,
    tabReady: false,
    growth: null,
  },

  onLoad() {
    installUpdatePerformanceLogger(this, 'map')
    const sysInfo = wx.getWindowInfo()
    this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 })
    this.initData()
  },

  onShow() {
    this.isVisible = true
    const tabBar = this.getTabBar?.()
    if (tabBar) {
      if ((tabBar.data as { selected?: number }).selected !== 0) tabBar.setData({ selected: 0 })
      if (!this.data.tabReady) this.setData({ tabReady: true })
    }
    // 从其他页返回时兜底恢复 tabBar（弹层打开期间会被隐藏）
    this.syncTabBarForSheets()
    const requestedMode = wx.getStorageSync<MapMode>(MAP_MODE_STORAGE_KEY)
    if (requestedMode === 'visited' || requestedMode === 'wishlist' || requestedMode === 'lighting') {
      wx.removeStorageSync(MAP_MODE_STORAGE_KEY)
      if (requestedMode !== this.data.mode) this.applyMode(requestedMode, { fit: true })
    }
    if (wx.getStorageSync<string>(PENDING_MAP_ACTION_STORAGE_KEY) === 'checkin') {
      wx.removeStorageSync(PENDING_MAP_ACTION_STORAGE_KEY)
      this.onCheckin()
    }
    const settings = getMapSettings()
    if (JSON.stringify(settings) !== JSON.stringify(this.data.settings)) {
      this.setData({
        settings,
        clusterEnabled: settings.clusterEnabled,
        mapLayerStyle: MAP_STYLE_IDS[settings.theme],
      }, () => {
        if (this.allFootprints.length) this.refreshMarkers()
      })
    }
    // onLoad is already fetching the first screen. Repeating the cache refresh here
    // causes a second request and several full native-map redraws during tab entry.
    if (this.pendingFootprints) {
      const pending = this.pendingFootprints
      this.pendingFootprints = null
      this.applyFootprints(pending)
    } else if (!this.data.loading) this.refreshFromCache()
  },

  onHide() {
    this.isVisible = false
  },

  onReady() {
    mapContext = wx.createMapContext('sgjMap', this)
    this.mapReady = true
    this.setData({ growthCircles: buildGrowthCircles(this.data.growthCities) }, () => {
      this.refreshMarkers()
    })
  },

  async initData() {
    try {
      this.setData({ loading: true })
      const profile = getLocalProfile()
      app.globalData.profile = profile
      await this.loadFootprints(true, true)
      // 首屏先使用本地缓存；云端成功后再静默刷新，断网也不阻塞地图。
      setTimeout(() => {
        loginForAccess().then((cloudProfile) => {
          app.globalData.profile = cloudProfile
          if (hasCloudAccess()) this.loadFootprints(false, true)
        }).catch(() => undefined)
      }, 350)
    } catch (err) {
      console.warn('[map] init failed', err)
      this.setData({ loading: false, empty: true })
    }
  },

  async refreshFromCache() {
    const sequence = ++this.loadSequence
    try {
      const list = await listFootprints({ maxAgeMs: FOOTPRINTS_MAX_AGE_MS })
      if (sequence !== this.loadSequence) return
      if (!this.isVisible) {
        this.pendingFootprints = list
        return
      }
      this.applyFootprints(list)
    } catch (err) {
      console.warn('[map] refresh failed', err)
    }
  },

  async loadFootprints(showLoading: boolean, fit = false) {
    const sequence = ++this.loadSequence
    if (showLoading) wx.showLoading({ title: '加载中', mask: true })
    try {
      const list = await listFootprints()
      if (sequence !== this.loadSequence) return
      if (!this.isVisible) {
        this.pendingFootprints = list
        return
      }
      this.applyFootprints(list, { fit })
    } catch (err) {
      console.warn('[map] load footprints failed', err)
      this.setData({ loading: false, empty: true })
    } finally {
      if (showLoading) wx.hideLoading()
    }
  },

  applyFootprints(list: Footprint[], options: { fit?: boolean } = {}) {
    const fit = options.fit === true
    // 引用相同说明数据未变（典型为热切回地图），整段重算与 setData 都可跳过
    if (list === this.allFootprints && !fit) return
    this.allFootprints = list
    const byId: Record<string, Footprint> = {}
    for (const fp of list) byId[fp.id] = fp
    this.footprintsById = byId
    this.dataVersion += 1
    const currentFilter = this.data.currentFilter
    const filtered = list.filter((fp) => matchesFilter(fp, currentFilter))
    this.filteredFootprints = filtered
    const chips = filterChips(currentFilter)
    const growthCities = computeCityGrowth(list)
    const view = this.computeModeView(this.data.mode)
    this.setData({
      moods: usedMoods(list),
      categories: usedCategories(list),
      lighting: computeLighting(filtered),
      growthCities,
      growthCircles: this.mapReady ? buildGrowthCircles(growthCities) : [],
      loading: false,
      empty: list.length === 0,
      activeFilterCount: chips.length,
      activeFilterChips: chips,
      growth: computeGrowthOverview(list, app.globalData.profile),
      ...view.fields,
    })
    if (fit) this.fitToFootprints(view.modeList)
    this.refreshMarkers()
  },

  computeModeView(mode: MapMode): ModeView {
    const modeList = this.filteredFootprints.filter((fp: Footprint) =>
      mode === 'wishlist' ? fp.status !== 'visited' : fp.status === 'visited',
    )
    const unplaced = modeList.filter(
      (fp: Footprint) => typeof fp.lat !== 'number' || typeof fp.lng !== 'number',
    )
    const copy = modeCopy(mode)
    return {
      modeList,
      fields: {
        modeEmpty: modeList.length === 0,
        unplacedFootprints: unplaced.map(buildUnplacedFootprintItem),
        modeEmptyTitle: copy.title,
        modeEmptyDescription: copy.description,
      },
    }
  },

  /** 模式切换：合并提交模式与空态字段，仅在确需重定位时调整视野 */
  applyMode(mode: MapMode, options: { fit?: boolean } = {}) {
    const view = this.computeModeView(mode)
    this.setData({ mode, ...view.fields })
    if (options.fit) this.fitToFootprints(view.modeList)
    this.refreshMarkers()
  },

  /** 过滤条件变化：合并提交筛选与空态字段，标记按新数据版本重建 */
  applyFilter(filter: FilterState, options: { closeSheet?: boolean; fit?: boolean } = {}) {
    this.dataVersion += 1
    this.filteredFootprints = this.allFootprints.filter((fp: Footprint) => matchesFilter(fp, filter))
    const chips = filterChips(filter)
    const view = this.computeModeView(this.data.mode)
    this.setData({
      currentFilter: filter,
      activeFilterCount: chips.length,
      activeFilterChips: chips,
      filterVisible: options.closeSheet ? false : this.data.filterVisible,
      lighting: computeLighting(this.filteredFootprints),
      ...view.fields,
    })
    if (options.fit) this.fitToFootprints(view.modeList)
    this.refreshMarkers()
    this.syncTabBarForSheets()
  },

  /** 标记构建带缓存：数据版本、模式、聚合开关、缩放档位与设置都没变时直接复用 */
  buildMarkers(force = false): MarkerIndex | null {
    const { mode, settings, clusterEnabled } = this.data
    const key = [
      this.dataVersion,
      mode,
      clusterEnabled ? 1 : 0,
      this.zoomTier,
      settings.markerStyle,
      settings.theme,
    ].join('|')
    if (!force && key === this.markerCacheKey && this.markerCache) return null

    const target = footprintsForMapMode(this.filteredFootprints, mode)
    const validForMap = target.filter(
      (fp: Footprint) => typeof fp.lat === 'number' && typeof fp.lng === 'number',
    )

    // 同一 POI 可有多次到访，但地图默认只显示一个点。
    const visitCounts: Record<string, number> = {}
    const placeMap = new Map<string, Footprint>()
    for (const fp of validForMap) {
      visitCounts[fp.id] = (visitCounts[fp.id] || 0) + 1
      const key = placeKey(fp)
      const current = placeMap.get(key)
      if (!current || fp.updatedAt > current.updatedAt) placeMap.set(key, fp)
    }
    const mapFootprints = [...placeMap.values()]
    for (const fp of validForMap) {
      const representative = placeMap.get(placeKey(fp))
      if (representative) {
        visitCounts[representative.id] = (visitCounts[representative.id] || 0) + (fp.id === representative.id ? 0 : 1)
      }
    }

    let items: Array<Footprint | ClusterMarker>
    if (clusterEnabled && this.zoomTier < 14) {
      items = clusterFootprints(mapFootprints, this.zoomTier)
      // utils 会把 2~3 个相邻点判定为不聚合；补回这些独立点，避免标记消失。
      const included = new Set<string>()
      for (const item of items) {
        if ((item as ClusterMarker).footprintIds) {
          for (const id of (item as ClusterMarker).footprintIds) included.add(id)
        } else {
          included.add((item as Footprint).id)
        }
      }
      items.push(...mapFootprints.filter((fp) => !included.has(fp.id)))
    } else {
      items = mapFootprints
    }

    const markers: MapMarker[] = []
    const markerIdMap: Record<number, string> = {}
    const clusterMarkers: Record<number, ClusterMarker> = {}

    items.forEach((item, idx) => {
      const id = idx + 1
      if ((item as ClusterMarker).footprintIds) {
        const cluster = item as ClusterMarker
        clusterMarkers[id] = cluster
        markers.push(buildClusterMarker(cluster, id, mode))
      } else {
        const fp = item as Footprint
        markerIdMap[id] = fp.id
        markers.push(buildMarker(fp, id, mode, settings, this.zoomTier, visitCounts[fp.id] || 1))
      }
    })

    const index: MarkerIndex = { markers, markerIdMap, clusterMarkers }
    this.markerCacheKey = key
    this.markerCache = index
    return index
  },

  /** 仅在标记内容真正变化时提交 markers，减少原生地图重绘 */
  refreshMarkers() {
    if (!this.mapReady) return
    const update = this.buildMarkers()
    if (update) this.setData({ markers: update.markers })
  },

  fitToFootprints(list: Footprint[]) {
    const target = list.filter(
      (fp) => typeof fp.lat === 'number' && typeof fp.lng === 'number',
    )
    const next = target.length
      ? fitBounds(target)
      : { latitude: DEFAULT_CENTER.latitude, longitude: DEFAULT_CENTER.longitude, scale: DEFAULT_SCALE }
    const prev = this.data.center
    if (
      prev &&
      Math.abs(prev.latitude - next.latitude) < 1e-9 &&
      Math.abs(prev.longitude - next.longitude) < 1e-9 &&
      this.data.scale === next.scale
    ) {
      return
    }
    this.mapScale = next.scale
    this.zoomTier = scaleToZoom(next.scale)
    this.setData({ center: { latitude: next.latitude, longitude: next.longitude }, scale: next.scale })
  },

  onModeTap(e: WechatMiniprogram.TouchEvent) {
    recordInteraction('map.mode')
    const mode = e.currentTarget.dataset.mode as MapMode
    if (mode === this.data.mode) return
    this.closeDetailSheet()
    this.applyMode(mode, { fit: true })
  },

  onMarkerTap(
    e: WechatMiniprogram.CustomEvent<{ markerId: number }>,
  ) {
    recordInteraction('map.marker')
    const markerId = e.detail.markerId
    const cache = this.markerCache
    if (!cache) return
    const cluster = cache.clusterMarkers[markerId]
    if (cluster) {
      const nextScale = Math.min(this.mapScale + 3, 18)
      this.mapScale = nextScale
      this.zoomTier = scaleToZoom(nextScale)
      this.setData({
        center: { latitude: cluster.latitude, longitude: cluster.longitude },
        scale: nextScale,
      })
      this.refreshMarkers()
      return
    }
    const footprintId = cache.markerIdMap[markerId]
    if (!footprintId) return
    const fp = this.footprintsById[footprintId]
    if (!fp) return
    this.closeDetailSheet()
    this.setData({ selectedFootprint: fp, detailVisible: true, detailClosing: false })
    this.syncTabBarForSheets()
  },

  onMapTap() {
    if (this.data.detailVisible) {
      this.closeDetailSheet()
    }
  },

  onRegionChange(
    e: WechatMiniprogram.CustomEvent<{ type: 'begin' | 'end'; scale?: number }>,
  ) {
    if (e.detail.type !== 'end') return
    const settle = (scale: number) => {
      if (typeof scale !== 'number' || !Number.isFinite(scale)) return
      // 拖动或程序设定视野的回声：缩放档位未跨越时不写 data、不重建标记，
      // 避免反写 scale 触发原生地图再渲染以及与 regionchange 相互触发。
      if (Math.abs(scale - this.mapScale) < 0.05) return
      this.mapScale = scale
      const tier = scaleToZoom(scale)
      if (tier === this.zoomTier) return
      this.zoomTier = tier
      this.refreshMarkers()
    }
    if (typeof e.detail.scale === 'number') settle(e.detail.scale)
    else mapContext?.getScale({ success: ({ scale }) => settle(scale) })
  },

  onCheckin() {
    recordInteraction('map.checkin')
    wx.showLoading({ title: '正在获取位置', mask: true })
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        const candidate = findNearbyCheckinCandidate(
          res.latitude,
          res.longitude,
          this.allFootprints,
        )
        const distance = candidate ? Math.round(candidate.distance) : 0
        this.mapScale = 16
        this.zoomTier = scaleToZoom(16)
        this.setData({
          center: { latitude: res.latitude, longitude: res.longitude },
          scale: 16,
          hasLocationAuth: true,
          checkinVisible: true,
          checkinCandidate: candidate,
          checkinDistance: distance,
        })
        this.refreshMarkers()
        this.syncTabBarForSheets()
        mapContext?.moveToLocation({
          latitude: res.latitude,
          longitude: res.longitude,
          fail: () => {},
        })
      },
      fail: () => {
        wx.showToast({ title: '请授权位置信息', icon: 'none' })
      },
      complete: () => wx.hideLoading(),
    })
  },

  onCheckinClose() {
    this.closeCheckinSheet()
  },

  onCheckinConfirm() {
    const candidate = this.data.checkinCandidate
    if (!candidate) return
    this.setData({ checkinVisible: false, checkinClosing: false })
    this.syncTabBarForSheets()
    wx.vibrateShort({ type: 'light', fail: () => {} })
    wx.navigateTo({ url: buildCheckinRoute(candidate) })
  },

  onCheckinChoosePlace() {
    this.setData({ checkinVisible: false })
    this.syncTabBarForSheets()
    wx.chooseLocation({
      success: (res) => {
        const draft = {
          poiName: res.name || '当前位置',
          address: res.address,
          lat: res.latitude,
          lng: res.longitude,
          visitDate: todayKey(),
          status: 'visited' as const,
          photos: [] as string[],
          tags: [] as string[],
          source: 'manual' as const,
        }
        wx.setStorageSync('sgj:quick-place', draft)
        wx.navigateTo({ url: '/pages/footprint-form/index?from=place&status=visited&checkin=1' })
      },
      fail: () => {},
    })
  },

  onFilter() {
    recordInteraction('map.filter')
    this.setData({ filterVisible: true })
    this.syncTabBarForSheets()
  },

  onFilterApply(e: WechatMiniprogram.CustomEvent<{ filter: FilterState }>) {
    this.applyFilter(e.detail.filter || {}, { closeSheet: true, fit: true })
  },

  onFilterReset() {
    this.applyFilter({}, { closeSheet: true, fit: true })
  },

  onFilterChipRemove(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key) as keyof FilterState
    const next: FilterState = { ...this.data.currentFilter }
    if (key === 'dateStart') {
      delete next.dateStart
      delete next.dateEnd
    } else {
      delete next[key]
      if (key === 'province') delete next.city
    }
    this.applyFilter(next, { fit: true })
  },

  onFilterClose() {
    this.setData({ filterVisible: false })
    this.syncTabBarForSheets()
  },

  onMapControlClusterToggle(
    e: WechatMiniprogram.CustomEvent<{ enabled: boolean }>,
  ) {
    const enabled = Boolean(e.detail?.enabled)
    const settings: MapSettings = { ...this.data.settings, clusterEnabled: enabled }
    saveMapSettings(settings)
    this.setData({ settings, clusterEnabled: enabled })
    this.refreshMarkers()
  },

  onGrowthTap() {
    wx.navigateTo({ url: '/pages/growth/index' })
  },

  onDetailTap() {
    const fp = this.data.selectedFootprint
    if (!fp) return
    wx.navigateTo({ url: `/pages/footprint-detail/index?id=${fp.id}` })
  },

  onUnplacedTap(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (id) wx.navigateTo({ url: `/pages/footprint-detail/index?id=${id}` })
  },

  onDetailClose() {
    this.closeDetailSheet()
  },

  /** 弹层（详情/打卡/筛选）打开期间隐藏自定义 tabBar：tabBar 在独立原生层，页面 z-index 压不住，会盖住弹层底部按钮 */
  syncTabBarForSheets() {
    const { detailVisible, checkinVisible, filterVisible } = this.data
    const tabBar = this.getTabBar?.()
    const hidden = detailVisible || checkinVisible || filterVisible
    if (tabBar && (tabBar.data as { hidden?: boolean }).hidden !== hidden) {
      tabBar.setData({ hidden })
    }
  },

  /** 详情半屏退场：播完下滑动画再卸载 */
  closeDetailSheet() {
    if (this.detailCloseTimer) {
      clearTimeout(this.detailCloseTimer)
      this.detailCloseTimer = null
    }
    if (!this.data.detailVisible) {
      this.setData({ detailClosing: false })
      this.syncTabBarForSheets()
      return
    }
    this.setData({ detailVisible: false, detailClosing: true })
    this.detailCloseTimer = setTimeout(() => {
      this.detailCloseTimer = null
      // 退场期间可能已重新打开详情（快速连点标记）：只收尾动画标记，不清空选中态
      if (this.data.detailVisible) {
        this.setData({ detailClosing: false })
        return
      }
      this.setData({ detailClosing: false, selectedFootprint: null })
      this.syncTabBarForSheets()
    }, 240)
  },

  /** 打卡面板退场 */
  closeCheckinSheet() {
    if (this.checkinCloseTimer) {
      clearTimeout(this.checkinCloseTimer)
      this.checkinCloseTimer = null
    }
    if (!this.data.checkinVisible) {
      this.setData({ checkinClosing: false })
      this.syncTabBarForSheets()
      return
    }
    this.setData({ checkinVisible: false, checkinClosing: true })
    this.checkinCloseTimer = setTimeout(() => {
      this.checkinCloseTimer = null
      this.setData({ checkinClosing: false })
      this.syncTabBarForSheets()
    }, 240)
  },

  onEmptyAction() {
    const status = this.data.mode === 'wishlist' ? 'wishlist' : 'visited'
    wx.navigateTo({ url: `/pages/footprint-form/index?status=${status}` })
  },

  preventMove() {},
})
