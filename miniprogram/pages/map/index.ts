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
  getFootprintSnapshot,
  didFootprintCloudLoadFail,
} from '../../services/repository'
import {
  clusterFootprints,
  fitBounds,
  footprintsForMapMode,
  hasMapCoordinates,
  markerPhotoForZoom,
} from '../../utils/map'
import {
  buildCheckinRoute,
  CHECKIN_SOURCE_STORAGE_KEY,
  findNearbyCheckinCandidate,
} from '../../utils/checkin'
import type { CheckinCandidate } from '../../utils/checkin'
import { matchesFilter, computeLighting, computeCityGrowth, placeKey, usedMoods, usedCategories } from '../../utils/footprint'
import { formatVisitDate, todayKey } from '../../utils/date'
import { moodEmoji } from '../../data/options'
import { CITY_CENTERS } from '../../data/city-centers'
import { MAP_STYLE_IDS, MAP_STYLE_SUBKEY } from '../../services/config'
import { MAP_TARGET_STORAGE_KEY, MAP_TAB_ENTRY_STORAGE_KEY, CITY_STAMP_TARGET_STORAGE_KEY, shortCity, shortProvince } from '../../utils/location'
import { computeGrowthOverview } from '../../utils/growth'
import { installUpdatePerformanceLogger, recordInteraction } from '../../utils/performance'
import { startPerformanceSpan } from '../../utils/performance'
import { budgetMapItems, inMapViewport, visibleMapItems } from '../../utils/map-viewport'
import type { MapViewport } from '../../utils/map-viewport'
import {
  buildProvincePolygons,
  provinceAt,
  provinceOverviews,
  provinceViewport,
  resolveProvince,
} from '../../utils/province-map'
import type { ProvinceOverview, ProvincePolygon } from '../../utils/province-map'
import { trackProductEvent } from '../../services/product-events'

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
  locationLabel: string
  hasExactLocation: boolean
  canFocusOnMap: boolean
}

interface GrowthCircle {
  latitude: number
  longitude: number
  radius: number
  color: string
  fillColor: string
  strokeWidth: number
}

interface UserLocation {
  latitude: number
  longitude: number
}

/**
 * WXML 只渲染界面控件所需的轻量字段；完整足迹、过滤结果与标记索引
 * 都放在页面实例上，避免每次 setData 把大对象整份传到渲染层。
 */
interface PageData {
  mode: MapMode
  markers: MapMarker[]
  unplacedFootprints: UnplacedFootprintItem[]
  unplacedTotal: number
  clusterItems: UnplacedFootprintItem[]
  clusterTotal: number
  selectedWishlistId: string
  filterVisible: boolean
  currentFilter: FilterState
  moods: string[]
  categories: string[]
  settings: MapSettings
  mapStyleSubkey: string
  mapLayerStyle: number
  clusterEnabled: boolean
  loading: boolean
  dataLoadFailed: boolean
  modeEmpty: boolean
  modeEmptyTitle: string
  modeEmptyDescription: string
  activeFilterCount: number
  activeFilterChips: FilterChip[]
  hasLocationAuth: boolean
  locationStatus: 'idle' | 'locating' | 'located' | 'denied' | 'failed'
  selectedFootprint: Footprint | null
  detailVisible: boolean
  detailClosing: boolean
  center: { latitude: number; longitude: number }
  scale: number
  lighting: LightingStats | null
  growthCities: CityGrowth[]
  growthCircles: GrowthCircle[]
  provincePolygons: ProvincePolygon[]
  provinceOverviews: ProvinceOverview[]
  selectedProvince: string
  selectedProvinceOverview: ProvinceOverview | null
  checkinVisible: boolean
  checkinClosing: boolean
  recordSheetVisible: boolean
  checkinCandidate: CheckinCandidate | null
  checkinDistance: number
  isLocating: boolean
  checkinPressed: boolean
  mapTilesReady: boolean
  regionCities: Record<string, string[]>
  mapLoadDelayed: boolean
  mapLoadFailed: boolean
  mapVisible: boolean
  statusBarHeight: number
  tabReady: boolean
  growth: GrowthOverview | null
}

interface MarkerIndex {
  markers: MapMarker[]
  markerIdMap: Record<number, string>
  clusterMarkers: Record<number, ClusterMarker>
  lightingCities: Record<number, { city: string; province: string }>
}

interface ModeView {
  modeList: Footprint[]
  fields: {
    modeEmpty: boolean
    unplacedFootprints: UnplacedFootprintItem[]
    unplacedTotal: number
    modeEmptyTitle: string
    modeEmptyDescription: string
  }
}

const DEFAULT_CENTER = { latitude: 35.0, longitude: 105.0 }
const DEFAULT_SCALE = 4
const LIGHTING_OVERVIEW_SCALE = 3
const USER_AREA_SCALE = 12
// 与 repository 的共享缓存配合：热切回地图 60 秒内不重新请求足迹
const FOOTPRINTS_MAX_AGE_MS = 60_000
const MAP_MODE_STORAGE_KEY = 'sgj:map-mode'
const PENDING_MAP_ACTION_STORAGE_KEY = 'sgj:pending-map-action'

const app = getApp<IAppOption>()
let mapContext: WechatMiniprogram.MapContext | undefined
const BRAND_MARKER_ICON = '/assets/icons/map-marker-brand.png'
// Native map markers reuse their rendered icon when an id is reused. Keep
// cluster ids apart from footprint ids when switching zoom levels.
const CLUSTER_MARKER_ID_BASE = 1_000_000
const LIGHTING_CITY_MARKER_ID_BASE = 2_000_000
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

// 城市参考点只表达城市范围；没有可核实的城市时不借用别人的 POI 或省份中心。
const wishlistViewport = (fp: Footprint) => {
  if (hasMapCoordinates(fp)) return { latitude: fp.lat!, longitude: fp.lng!, scale: 14, precision: 'exact' as const }
  const city = shortCity(fp.city || fp.poiName || '')
  const province = shortProvince(fp.province || '')
  const center = CITY_CENTERS[`${province || city}/${city}`]
  return center ? { latitude: center[0], longitude: center[1], scale: 11, precision: 'city' as const } : undefined
}

const selectedWishlistFor = (records: Footprint[], currentId: string): string => {
  const current = records.find((fp) => fp.id === currentId)
  if (current && wishlistViewport(current)) return currentId
  return records.find((fp) => wishlistViewport(fp))?.id || ''
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

const buildUnplacedFootprintItem = (fp: Footprint): UnplacedFootprintItem => {
  const viewport = wishlistViewport(fp)
  return {
    id: fp.id,
    poiName: fp.poiName,
    photo: fp.photoThumbs?.[0] || fp.photos?.[0] || '',
    dateLabel: formatVisitDate(fp.visitDate),
    statusLabel: fp.status === 'wishlist' ? '想去' : fp.status === 'fulfilled' ? '已实现' : '已到访',
    isWishlist: fp.status !== 'visited',
    locationLabel: viewport?.precision === 'exact'
      ? '精确位置'
      : viewport?.precision === 'city' ? `${fp.city || fp.poiName} · 城市范围` : '待补充位置',
    hasExactLocation: hasMapCoordinates(fp),
    canFocusOnMap: Boolean(viewport),
  }
}

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
    // Keep a real tap target under the native count callout. A 2 px transparent
    // marker looks right but makes the badge effectively impossible to open.
    width: 44,
    height: 44,
    iconPath: '/assets/icons/map-marker-transparent.png',
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
  return { title: '先点亮去过的城市', description: '不用照片和定位，选一座去过的城市，马上看到自己的地图。' }
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

/** A city stamp is an actual visited city, never a live or draft location. */
const buildLightingCityMarkers = (
  footprints: Footprint[],
  overviews: ProvinceOverview[],
): Pick<MarkerIndex, 'markers' | 'lightingCities'> => {
  const markers: MapMarker[] = []
  const lightingCities: MarkerIndex['lightingCities'] = {}
  for (const overview of overviews) {
    for (const cityName of overview.cityNames) {
      const city = shortCity(cityName)
      const province = shortProvince(overview.name)
      const reference = CITY_CENTERS[`${province}/${city}`]
      const matching = footprints.filter((fp) =>
        fp.status === 'visited'
        && shortCity(fp.city || '') === city
        && (resolveProvince(fp.province || '') || (hasMapCoordinates(fp) ? provinceAt(fp.lat!, fp.lng!) : undefined)) === overview.name
        && hasMapCoordinates(fp),
      )
      const latitude = reference?.[0] ?? (matching.length
        ? matching.reduce((sum, fp) => sum + fp.lat!, 0) / matching.length : undefined)
      const longitude = reference?.[1] ?? (matching.length
        ? matching.reduce((sum, fp) => sum + fp.lng!, 0) / matching.length : undefined)
      if (latitude === undefined || longitude === undefined) continue
      const id = LIGHTING_CITY_MARKER_ID_BASE + markers.length
      lightingCities[id] = { city: cityName, province: overview.name }
      markers.push({
        id,
        latitude,
        longitude,
        title: `${cityName} · 已点亮`,
        width: 26,
        height: 33,
        iconPath: BRAND_MARKER_ICON,
        callout: {
          content: cityName,
          color: '#3543A5',
          fontSize: 13,
          bgColor: '#FFFFFF',
          padding: 7,
          borderRadius: 10,
          display: 'ALWAYS',
        },
      })
    }
  }
  return { markers, lightingCities }
}

Page<PageData, WechatMiniprogram.IAnyObject>({
  detailCloseTimer: null,
  checkinCloseTimer: null,
  mapReadyFallbackTimer: null,

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
  viewportRegion: null as MapViewport | null,
  viewportKey: '',
  viewportRequestId: 0,
  regionRefreshTimer: null as ReturnType<typeof setTimeout> | null,
  allUnplacedItems: [] as UnplacedFootprintItem[],
  unplacedLimit: 20,
  allClusterItems: [] as UnplacedFootprintItem[],
  clusterLimit: 20,
  partialLoad: false,
  isVisible: false,
  mapReady: false,
  initialLocationStarted: false,
  locationIntent: 0,
  initialLocationResolved: false,
  hasCenteredOnUser: false,
  hasExplicitMapTarget: false,
  wasHidden: false,
  checkinLocationRequested: false,
  locationPromise: null as Promise<UserLocation> | null,
  initialDataPromise: null as Promise<void> | null,
  loadSequence: 0,
  pendingFootprints: null as Footprint[] | null,
  pendingCityProvince: '',
  cityAutoLightingDone: false,
  mapRetrying: false,
  checkinNavigating: false,
  emptyNavigating: false,

  data: {
    mode: 'visited',
    markers: [],
    unplacedFootprints: [],
    unplacedTotal: 0,
    clusterItems: [],
    clusterTotal: 0,
    selectedWishlistId: '',
    filterVisible: false,
    currentFilter: {},
    moods: [],
    categories: [],
    settings: getMapSettings(),
    mapStyleSubkey: MAP_STYLE_SUBKEY,
    mapLayerStyle: MAP_STYLE_IDS[getMapSettings().theme],
    clusterEnabled: getMapSettings().clusterEnabled,
    loading: true,
    dataLoadFailed: false,
    modeEmpty: false,
    modeEmptyTitle: '还没有足迹',
    modeEmptyDescription: '去一个地方，留下你的第一枚拾光',
    activeFilterCount: 0,
    activeFilterChips: [],
    hasLocationAuth: false,
    locationStatus: 'idle',
    selectedFootprint: null,
    detailVisible: false,
    detailClosing: false,
    center: DEFAULT_CENTER,
    scale: DEFAULT_SCALE,
    lighting: null,
    growthCities: [],
    growthCircles: [],
    provincePolygons: [],
    provinceOverviews: [],
    selectedProvince: '',
    selectedProvinceOverview: null,
    checkinVisible: false,
    checkinClosing: false,
    recordSheetVisible: false,
    checkinCandidate: null,
    checkinDistance: 0,
    isLocating: false,
    checkinPressed: false,
    mapTilesReady: false,
    regionCities: {},
    mapLoadDelayed: false,
    mapLoadFailed: false,
    mapVisible: true,
    statusBarHeight: 20,
    tabReady: false,
    growth: null,
  },

  onLoad() {
    installUpdatePerformanceLogger(this, 'map')
    const sysInfo = wx.getWindowInfo()
    this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 })
    this.initialDataPromise = this.initData()
  },

  onShow() {
    const returningToMap = this.wasHidden
    this.wasHidden = false
    this.isVisible = true
    this.checkinNavigating = false
    this.emptyNavigating = false
    const cityProvince = wx.getStorageSync<string>(CITY_STAMP_TARGET_STORAGE_KEY)
    if (cityProvince) {
      this.pendingCityProvince = cityProvince
      wx.removeStorageSync(CITY_STAMP_TARGET_STORAGE_KEY)
    }
    const enteredFromTab = Boolean(wx.getStorageSync(MAP_TAB_ENTRY_STORAGE_KEY))
    wx.removeStorageSync(MAP_TAB_ENTRY_STORAGE_KEY)
    const target = wx.getStorageSync<Footprint | undefined>(MAP_TARGET_STORAGE_KEY)
    if (target) {
      this.locationIntent += 1
      wx.removeStorageSync(MAP_TARGET_STORAGE_KEY)
      this.initialLocationStarted = true
      this.initialLocationResolved = true
      this.hasCenteredOnUser = true
      this.hasExplicitMapTarget = true
      this.setData({ locationStatus: this.data.hasLocationAuth ? 'located' : 'idle' })
      this.applyFilter({})
      this.applyMode(target.status === 'visited' ? 'visited' : 'wishlist')
      if (hasMapCoordinates(target)) {
        this.mapScale = 15
        this.zoomTier = scaleToZoom(15)
        this.setData({ center: { latitude: target.lat!, longitude: target.lng! }, scale: 15 })
      }
      this.setData({ selectedFootprint: target, detailVisible: true, detailClosing: false })
    }
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
    const shouldOpenCheckin = wx.getStorageSync<string>(PENDING_MAP_ACTION_STORAGE_KEY) === 'checkin'
    if (shouldOpenCheckin) {
      wx.removeStorageSync(PENDING_MAP_ACTION_STORAGE_KEY)
      // 冷启动由快捷打卡接管本次定位，避免与首屏自动定位并发调用 getLocation。
      this.initialLocationStarted = true
      this.onCheckin()
    } else if (!target && this.data.mode === 'visited') {
      this.autoLocateOnEntry(enteredFromTab || (returningToMap && !this.hasExplicitMapTarget))
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
    // 保存页会同步更新 repository 的内存快照。返回地图时优先使用它，避免
    // 较早发起的异步列表请求或 60 秒热缓存覆盖刚新增的足迹。
    const latestSnapshot = getFootprintSnapshot()
    if (latestSnapshot && latestSnapshot !== this.allFootprints) {
      this.pendingFootprints = null
      // 快捷打卡返回时只刷新标记和数据，保留刚刚获取到的当前位置视野。
      // 未成功定位时才继续沿用“适配全部足迹”的原有行为。
      this.applyFootprints(latestSnapshot, { fit: !this.hasCenteredOnUser && this.data.locationStatus !== 'locating' })
    } else if (this.pendingFootprints) {
      const pending = this.pendingFootprints
      this.pendingFootprints = null
      this.applyFootprints(pending)
    } else if (!this.data.loading) this.refreshFromCache()
  },

  onHide() {
    this.wasHidden = true
    this.isVisible = false
    if (this.regionRefreshTimer) clearTimeout(this.regionRefreshTimer)
    this.regionRefreshTimer = null
    // 已隐藏页面的权限/定位回调不得抢回地图中心；下一次显示可重新发起。
    this.locationIntent += 1
    if (this.data.locationStatus === 'locating') this.setData({ locationStatus: 'idle' })
  },

  onRecordSheetVisibilityChange(visible: boolean) {
    if (this.data.recordSheetVisible !== visible) this.setData({ recordSheetVisible: visible })
  },

  onReady() {
    mapContext = wx.createMapContext('sgjMap', this)
    this.mapReady = true
    this.scheduleMapReadyFallback()
    this.setData({ growthCircles: this.data.mode === 'lighting' ? [] : buildGrowthCircles(this.data.growthCities) }, () => {
      this.captureMapRegion()
    })
  },

  captureMapRegion() {
    if (!mapContext?.getRegion) {
      this.refreshMarkers()
      return
    }
    const requestId = ++this.viewportRequestId
    mapContext.getRegion({
      success: ({ northeast, southwest }) => {
        if (requestId !== this.viewportRequestId) return
        const key = [northeast.latitude, northeast.longitude, southwest.latitude, southwest.longitude]
          .map((value) => value.toFixed(4)).join(':')
        if (key !== this.viewportKey) {
          this.viewportRegion = { northeast, southwest }
          this.viewportKey = key
          this.refreshMarkers()
        }
      },
      fail: () => { if (requestId === this.viewportRequestId) this.refreshMarkers() },
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
          if (hasCloudAccess()) {
            const shouldFitCloudFootprints = !this.hasCenteredOnUser && this.allFootprints.length === 0
            this.loadFootprints(false, shouldFitCloudFootprints)
          } else if (!this.allFootprints.length) {
            this.setData({ dataLoadFailed: true })
          }
        }).catch(() => { if (!this.allFootprints.length) this.setData({ dataLoadFailed: true }) })
      }, 350)
    } catch (err) {
      console.warn('[map] init failed', err)
      this.setData({ loading: false, dataLoadFailed: true })
    }
  },

  async refreshFromCache() {
    const sequence = ++this.loadSequence
    try {
      const list = await listFootprints({ maxAgeMs: FOOTPRINTS_MAX_AGE_MS })
      if (sequence !== this.loadSequence) return
      if (didFootprintCloudLoadFail() && this.partialLoad && !list.length) {
        this.setData({ loading: false, dataLoadFailed: true })
        return
      }
      if (!this.isVisible) {
        this.pendingFootprints = list
        return
      }
      this.applyFootprints(list)
    } catch (err) {
      console.warn('[map] refresh failed', err)
      if (!this.allFootprints.length) this.setData({ dataLoadFailed: true })
    }
  },

  async loadFootprints(showLoading: boolean, fit = false) {
    const sequence = ++this.loadSequence
    if (showLoading && !this.data.loading) this.setData({ loading: true })
    try {
      const list = await listFootprints({ onProgress: (items, hasMore) => {
        if (hasMore && sequence === this.loadSequence && this.isVisible && !this.allFootprints.length) {
          this.applyFootprints(items, { partial: true })
        }
      } })
      if (sequence !== this.loadSequence) return
      if (didFootprintCloudLoadFail() && this.partialLoad && !list.length) {
        this.setData({ loading: false, dataLoadFailed: true })
        return
      }
      if (!this.isVisible) {
        this.pendingFootprints = list
        return
      }
      this.applyFootprints(list, {
        fit: fit && !this.hasCenteredOnUser && this.initialLocationResolved,
      })
    } catch (err) {
      console.warn('[map] load footprints failed', err)
      if (sequence === this.loadSequence) this.setData({ loading: false, dataLoadFailed: true })
    }
  },

  applyFootprints(list: Footprint[], options: { fit?: boolean; partial?: boolean } = {}) {
    const end = startPerformanceSpan('map.applyFootprints')
    const fit = options.fit === true
    // 引用相同说明数据未变（典型为热切回地图），整段重算与 setData 都可跳过
    if (list === this.allFootprints && !fit && !this.pendingCityProvince) return
    this.allFootprints = list
    this.partialLoad = Boolean(options.partial)
    const byId: Record<string, Footprint> = {}
    for (const fp of list) byId[fp.id] = fp
    this.footprintsById = byId
    this.dataVersion += 1
    const currentFilter = this.data.currentFilter
    const filtered = list.filter((fp) => matchesFilter(fp, currentFilter))
    this.filteredFootprints = filtered
    const chips = filterChips(currentFilter)
    const growthCities = computeCityGrowth(list)
    const overviews = provinceOverviews(filtered)
    const selectedOverview = overviews.find((item) => item.name === this.data.selectedProvince) || null
    const autoLighting = !this.cityAutoLightingDone && this.data.mode === 'visited'
      && list.some((fp) => fp.status === 'visited' && fp.recordLevel === 'city')
      && !list.some((fp) => fp.status === 'visited' && fp.recordLevel !== 'city')
    if (autoLighting) this.cityAutoLightingDone = true
    const effectiveMode: MapMode = autoLighting ? 'lighting' : this.data.mode
    const view: ModeView = this.computeModeView(effectiveMode)
    const selectedWishlistId = effectiveMode === 'wishlist'
      ? selectedWishlistFor(view.modeList, this.data.selectedWishlistId) : ''
    const shouldFocusNewWishlist = effectiveMode === 'wishlist'
      && Boolean(selectedWishlistId)
      && selectedWishlistId !== this.data.selectedWishlistId
    const regionCities: Record<string, string[]> = {}
    for (const fp of list) {
      if (!fp.province) continue
      const cities = regionCities[fp.province] ||= []
      if (fp.city && !cities.includes(fp.city)) cities.push(fp.city)
    }
    this.setData({
      mode: effectiveMode,
      selectedWishlistId,
      regionCities,
      moods: usedMoods(list),
      categories: usedCategories(list),
      ...(!options.partial ? {
        lighting: computeLighting(filtered),
        growthCities,
        growthCircles: this.mapReady && effectiveMode !== 'lighting' ? buildGrowthCircles(growthCities) : [],
        provinceOverviews: overviews,
        provincePolygons: effectiveMode === 'lighting'
          ? buildProvincePolygons(overviews.map((item) => item.name), this.data.selectedProvince)
          : [],
        selectedProvinceOverview: selectedOverview,
        growth: computeGrowthOverview(list, app.globalData.profile),
      } : {}),
      loading: Boolean(options.partial),
      dataLoadFailed: !options.partial && list.length === 0 && didFootprintCloudLoadFail(),
      activeFilterCount: chips.length,
      activeFilterChips: chips,
      ...view.fields,
    }, () => end({ records: list.length, partial: options.partial ? 1 : 0 }))
    if (this.pendingCityProvince) {
      const province = this.pendingCityProvince
      this.pendingCityProvince = ''
      if (this.data.mode !== 'lighting') this.applyMode('lighting')
      this.selectProvince(province, true)
    }
    if (fit || shouldFocusNewWishlist || autoLighting) this.fitToFootprints(view.modeList)
    this.refreshMarkers()
  },

  computeModeView(mode: MapMode, filter?: FilterState): ModeView {
    const modeList = this.filteredFootprints.filter((fp: Footprint) =>
      mode === 'wishlist' ? fp.status !== 'visited' : fp.status === 'visited' && fp.recordLevel !== 'city',
    )
    const cards = mode === 'wishlist' ? modeList : modeList.filter((fp: Footprint) => !hasMapCoordinates(fp))
    this.allUnplacedItems = cards.map((fp: Footprint) => buildUnplacedFootprintItem(fp))
    const copy = modeCopy(mode)
    const filtered = Object.values(filter || this.data.currentFilter).some(Boolean)
    return {
      modeList,
      fields: {
        modeEmpty: modeList.length === 0,
        unplacedFootprints: this.allUnplacedItems.slice(0, this.unplacedLimit),
        unplacedTotal: this.allUnplacedItems.length,
        modeEmptyTitle: filtered ? '没有符合筛选的记录' : copy.title,
        modeEmptyDescription: filtered ? '试试调整条件，或清除筛选查看全部记录。' : copy.description,
      },
    }
  },

  /** 模式切换：合并提交模式与空态字段，仅在确需重定位时调整视野 */
  applyMode(mode: MapMode, options: { fit?: boolean } = {}) {
    this.unplacedLimit = 20
    const view: ModeView = this.computeModeView(mode)
    const selectedWishlistId = mode === 'wishlist'
      ? selectedWishlistFor(view.modeList, this.data.selectedWishlistId) : ''
    this.setData({
      mode,
      selectedWishlistId,
      selectedProvince: '',
      selectedProvinceOverview: null,
      provincePolygons: mode === 'lighting'
        ? buildProvincePolygons(this.data.provinceOverviews.map((item) => item.name))
        : [],
      growthCircles: mode === 'lighting' ? [] : buildGrowthCircles(this.data.growthCities),
      ...view.fields,
    })
    if (options.fit) this.fitToFootprints(view.modeList)
    this.refreshMarkers()
  },

  /** 过滤条件变化：合并提交筛选与空态字段，标记按新数据版本重建 */
  applyFilter(filter: FilterState, options: { closeSheet?: boolean; fit?: boolean } = {}) {
    this.unplacedLimit = 20
    this.dataVersion += 1
    this.filteredFootprints = this.allFootprints.filter((fp: Footprint) => matchesFilter(fp, filter))
    const chips = filterChips(filter)
    const overviews = provinceOverviews(this.filteredFootprints)
    const selectedOverview = overviews.find((item) => item.name === this.data.selectedProvince) || null
    const view: ModeView = this.computeModeView(this.data.mode, filter)
    const selectedWishlistId = this.data.mode === 'wishlist'
      ? selectedWishlistFor(view.modeList, this.data.selectedWishlistId) : ''
    this.setData({
      currentFilter: filter,
      selectedWishlistId,
      activeFilterCount: chips.length,
      activeFilterChips: chips,
      filterVisible: options.closeSheet ? false : this.data.filterVisible,
      lighting: computeLighting(this.filteredFootprints),
      provinceOverviews: overviews,
      provincePolygons: this.data.mode === 'lighting'
        ? buildProvincePolygons(overviews.map((item) => item.name), this.data.selectedProvince)
        : [],
      selectedProvinceOverview: selectedOverview,
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
      this.data.selectedWishlistId,
      this.viewportKey,
    ].join('|')
    if (!force && key === this.markerCacheKey && this.markerCache) return null

    if (mode === 'lighting') {
      const { markers, lightingCities } = buildLightingCityMarkers(this.filteredFootprints, this.data.provinceOverviews)
      const visible = this.viewportRegion
        ? markers.filter((marker) => inMapViewport(marker.latitude, marker.longitude, this.viewportRegion!))
        : markers
      // 省份面板保留完整城市入口，原生地图一次只绘制当前视野中的部分城市。
      const index: MarkerIndex = { markers: visible.slice(0, 200), lightingCities, markerIdMap: {}, clusterMarkers: {} }
      this.markerCacheKey = key
      this.markerCache = index
      return index
    }

    const target = footprintsForMapMode(this.filteredFootprints, mode)
    const selectedWishlist = mode === 'wishlist'
      ? target.find((fp) => fp.id === this.data.selectedWishlistId)
      : undefined
    const validForMap = (selectedWishlist ? [selectedWishlist] : target).filter(hasMapCoordinates)

    // 同一 POI 可有多次到访，但地图默认只显示一个点。
    const visitCounts: Record<string, number> = {}
    const placeMap = new Map<string, Footprint>()
    for (const fp of validForMap) {
      visitCounts[fp.id] = (visitCounts[fp.id] || 0) + 1
      const key = placeKey(fp)
      const current = placeMap.get(key)
      if (!current || fp.updatedAt > current.updatedAt) placeMap.set(key, fp)
    }
    const mapFootprints = visibleMapItems([...placeMap.values()], this.viewportRegion)
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
    items = budgetMapItems(items, 200)

    const markers: MapMarker[] = []
    const markerIdMap: Record<number, string> = {}
    const clusterMarkers: Record<number, ClusterMarker> = {}

    items.forEach((item, idx) => {
      if ((item as ClusterMarker).footprintIds) {
        const id = CLUSTER_MARKER_ID_BASE + idx
        const cluster = item as ClusterMarker
        clusterMarkers[id] = cluster
        markers.push(buildClusterMarker(cluster, id, mode))
      } else {
        const id = idx + 1
        const fp = item as Footprint
        markerIdMap[id] = fp.id
        markers.push(buildMarker(fp, id, mode, settings, this.zoomTier, visitCounts[fp.id] || 1))
      }
    })

    if (selectedWishlist && !hasMapCoordinates(selectedWishlist)) {
      const viewport = wishlistViewport(selectedWishlist)
      if (viewport) {
        const id = markers.length + 1
        markerIdMap[id] = selectedWishlist.id
        markers.push({
          id,
          latitude: viewport.latitude,
          longitude: viewport.longitude,
          title: selectedWishlist.poiName,
          width: 32,
          height: 40,
          iconPath: '/assets/icons/map-marker-amber.png',
          callout: {
            content: `${selectedWishlist.poiName} · ${viewport.precision === 'city' ? '城市范围' : '省区范围'}`,
            color: '#5A421D', fontSize: 12, bgColor: '#FFF7E8', padding: 8, borderRadius: 12, display: 'ALWAYS',
          },
          markerId: selectedWishlist.id,
        })
      }
    }

    const index: MarkerIndex = { markers, markerIdMap, clusterMarkers, lightingCities: {} }
    this.markerCacheKey = key
    this.markerCache = index
    return index
  },

  /** 仅在标记内容真正变化时提交 markers，减少原生地图重绘 */
  refreshMarkers() {
    if (!this.mapReady) return
    const end = startPerformanceSpan('map.markers')
    const update = this.buildMarkers()
    if (update) this.setData({ markers: update.markers }, () => end({ markers: update.markers.length }))
    else end({ cached: 1 })
  },

  fitToFootprints(list: Footprint[]) {
    const target = list.filter(hasMapCoordinates)
    // 点亮模式要能看清具体城市。用城市中心拟合，并限制最大缩放，
    // 避免只有一两个城市时进入街道级地图，也避免全国缩放让近邻城市重叠。
    const litCities = this.data.mode === 'lighting'
      ? buildLightingCityMarkers(this.filteredFootprints, this.data.provinceOverviews).markers
      : []
    const litBounds = litCities.length > 1
      ? fitBounds(litCities.map((marker) => ({ lat: marker.latitude, lng: marker.longitude })))
      : null
    const selectedWishlist = this.data.mode === 'wishlist'
      ? list.find((fp) => fp.id === this.data.selectedWishlistId)
      : undefined
    const selectedViewport = selectedWishlist ? wishlistViewport(selectedWishlist) : undefined
    const next = this.data.mode === 'lighting'
      ? litBounds
        ? { ...litBounds, scale: Math.min(9, Math.max(4, litBounds.scale)) }
        : litCities.length === 1
          ? { latitude: litCities[0].latitude, longitude: litCities[0].longitude, scale: 8 }
          : { latitude: DEFAULT_CENTER.latitude, longitude: DEFAULT_CENTER.longitude, scale: LIGHTING_OVERVIEW_SCALE }
      : selectedViewport
        ? selectedViewport
      : target.length
        ? fitBounds(target)
        : { latitude: DEFAULT_CENTER.latitude, longitude: DEFAULT_CENTER.longitude, scale: DEFAULT_SCALE }
    // A native map gesture changes its real viewport without updating bound
    // data.scale/center. An explicit fit must still move it back even when the
    // requested view equals the last data sent to the component.
    this.mapScale = next.scale
    this.zoomTier = scaleToZoom(next.scale)
    this.viewportRequestId += 1
    this.viewportRegion = null
    this.viewportKey = ''
    this.setData({
      center: { latitude: next.latitude, longitude: next.longitude },
      scale: next.scale,
      mapTilesReady: false,
      mapLoadFailed: false,
    }, () => this.scheduleMapReadyFallback())
  },

  onModeTap(e: WechatMiniprogram.TouchEvent) {
    recordInteraction('map.mode')
    const mode = e.currentTarget.dataset.mode as MapMode
    if (mode === this.data.mode) return
    this.closeDetailSheet()
    this.applyMode(mode, { fit: mode !== 'visited' })
    if (mode === 'visited') this.autoLocateOnEntry(true)
  },

  onMarkerTap(
    e: WechatMiniprogram.CustomEvent<{ markerId: number }>,
  ) {
    recordInteraction('map.marker')
    const markerId = e.detail.markerId
    const cache = this.markerCache
    if (!cache) return
    const lightingCity = cache.lightingCities[markerId]
    if (lightingCity) {
      this.selectProvince(lightingCity.province)
      return
    }
    const cluster = cache.clusterMarkers[markerId]
    if (cluster) {
      if (this.mapScale >= 18) {
        this.allClusterItems = cluster.footprintIds
          .map((id: string) => this.footprintsById[id])
          .filter((fp: Footprint | undefined): fp is Footprint => Boolean(fp))
          .map((fp: Footprint) => buildUnplacedFootprintItem(fp))
        this.clusterLimit = 20
        this.setData({
          clusterItems: this.allClusterItems.slice(0, this.clusterLimit),
          clusterTotal: this.allClusterItems.length,
        })
        return
      }
      const nextScale = Math.min(this.mapScale + 3, 18)
      this.mapScale = nextScale
      this.zoomTier = scaleToZoom(nextScale)
      this.viewportRequestId += 1
      this.viewportRegion = null
      this.viewportKey = ''
      this.setData({
        center: { latitude: cluster.latitude, longitude: cluster.longitude },
        scale: nextScale,
        mapTilesReady: false,
        mapLoadFailed: false,
      }, () => this.scheduleMapReadyFallback())
      this.refreshMarkers()
      return
    }
    const footprintId = cache.markerIdMap[markerId]
    if (!footprintId) return
    const fp = this.footprintsById[footprintId]
    if (!fp) return
    if (!hasMapCoordinates(fp)) {
      wx.navigateTo({ url: `/pages/footprint-form/index?id=${fp.id}` })
      return
    }
    this.closeDetailSheet()
    this.setData({ selectedFootprint: fp, detailVisible: true, detailClosing: false })
    this.syncTabBarForSheets()
  },

  onMapTap(e: WechatMiniprogram.CustomEvent<{ latitude?: number; longitude?: number }>) {
    if (this.data.clusterItems.length) this.setData({ clusterItems: [], clusterTotal: 0 })
    if (this.data.detailVisible) {
      this.closeDetailSheet()
    }
    if (this.data.mode !== 'lighting') return
    const { latitude, longitude } = e.detail || {}
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return
    const name = provinceAt(latitude, longitude)
    if (name) this.selectProvince(name)
    else if (this.data.selectedProvince) this.clearProvinceSelection()
  },

  selectProvince(name: string, focus = false) {
    trackProductEvent('province_card_opened')
    const overview = this.data.provinceOverviews.find((item) => item.name === name) || null
    const update: Partial<PageData> = {
      selectedProvince: name,
      selectedProvinceOverview: overview,
      provincePolygons: buildProvincePolygons(this.data.provinceOverviews.map((item) => item.name), name),
    }
    if (focus) {
      const viewport = provinceViewport(name)
      if (viewport) {
        this.mapScale = viewport.scale
        this.zoomTier = scaleToZoom(viewport.scale)
        update.center = { latitude: viewport.latitude, longitude: viewport.longitude }
        update.scale = viewport.scale
      }
    }
    this.setData(update)
  },

  openPlaceForm(city = '') {
    wx.setStorageSync('sgj:quick-place', { country: '中国', province: this.data.selectedProvince, city })
    wx.navigateTo({ url: '/pages/footprint-form/index?from=place' })
  },

  onCityTap(e: WechatMiniprogram.TouchEvent) {
    this.openPlaceForm(String(e.currentTarget.dataset.city || ''))
  },

  onProvinceAddPlace() {
    this.openPlaceForm(this.data.selectedProvinceOverview?.cityNames[0] || '')
  },

  onOpenCityAlbum() {
    wx.navigateTo({ url: '/pages/city-album/index' })
  },

  onAddCity() {
    wx.navigateTo({ url: '/pages/city-stamp/index' })
  },

  clearProvinceSelection() {
    this.setData({
      selectedProvince: '',
      selectedProvinceOverview: null,
      provincePolygons: buildProvincePolygons(this.data.provinceOverviews.map((item) => item.name)),
    })
    this.fitToFootprints(this.computeModeView('lighting').modeList)
  },

  onProvinceChipTap(e: WechatMiniprogram.TouchEvent) {
    const name = String(e.currentTarget.dataset.name || '')
    if (name) this.selectProvince(name, true)
  },

  onProvinceCardClose() {
    this.clearProvinceSelection()
  },

  onProvinceMemoryTap(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (id) wx.navigateTo({ url: `/pages/footprint-detail/index?id=${id}` })
  },

  onMapError(e: WechatMiniprogram.CustomEvent<Record<string, unknown>>) {
    // 原生地图的鉴权、创建和网络错误不会抛到页面逻辑层，显式上报到
    // console 便于开发者工具、体验版 vConsole 与平台错误监控捕获。
    console.error('[map] native map error', e.detail)
    this.clearMapReadyFallback()
    this.setData({ mapTilesReady: false, mapLoadFailed: true })
  },

  onMapAbilityFail(e: WechatMiniprogram.CustomEvent<Record<string, unknown>>) {
    console.error('[map] native map ability failed', e.detail)
    this.clearMapReadyFallback()
    this.setData({ mapTilesReady: false, mapLoadFailed: true })
  },

  onMapUpdated() {
    this.clearMapReadyFallback()
    if (!this.viewportRegion) this.captureMapRegion()
    if (!this.data.mapTilesReady || this.data.mapLoadFailed) {
      this.setData({ mapTilesReady: true, mapLoadFailed: false, mapLoadDelayed: false })
    }
  },

  clearMapReadyFallback() {
    if (!this.mapReadyFallbackTimer) return
    clearTimeout(this.mapReadyFallbackTimer)
    this.mapReadyFallbackTimer = null
  },

  scheduleMapReadyFallback() {
    if (!this.mapReady) return
    this.clearMapReadyFallback()
    this.setData({ mapLoadDelayed: false })
    // 未收到 updated 不能推断瓦片已经加载；提供不遮挡地图的重新加载入口。
    this.mapReadyFallbackTimer = setTimeout(() => {
      this.mapReadyFallbackTimer = null
      if (!this.data.mapLoadFailed && !this.data.mapTilesReady) {
        this.setData({ mapLoadDelayed: true })
      }
    }, 5000)
  },

  retryMapLoad() {
    if (this.mapRetrying) return
    this.mapRetrying = true
    this.setData({
      mapVisible: false,
      mapTilesReady: false,
      mapLoadFailed: false,
      mapLoadDelayed: false,
    }, () => {
      wx.nextTick(() => {
        this.setData({ mapVisible: true }, () => {
          mapContext = wx.createMapContext('sgjMap', this)
          this.scheduleMapReadyFallback()
          setTimeout(() => { this.mapRetrying = false }, 1000)
        })
      })
    })
  },

  async retryFootprints() {
    if (this.data.loading) return
    this.setData({ loading: true })
    await loginForAccess({ force: true })
    if (!hasCloudAccess() && !this.allFootprints.length) {
      this.setData({ loading: false, dataLoadFailed: true })
      return
    }
    await this.loadFootprints(true, true)
  },

  onRegionChange(
    e: WechatMiniprogram.CustomEvent<{ type: 'begin' | 'end'; scale?: number; causedBy?: 'drag' | 'scale' | 'update' }>,
  ) {
    if (e.detail.type !== 'end') return
    if (this.regionRefreshTimer) clearTimeout(this.regionRefreshTimer)
    this.regionRefreshTimer = setTimeout(() => {
      this.regionRefreshTimer = null
      if (this.isVisible) this.captureMapRegion()
    }, 120)
    const settle = (scale: number) => {
      if (typeof scale !== 'number' || !Number.isFinite(scale)) return
      // Native map update events may arrive out of order after setData changes
      // the viewport. Only user zooming may override the requested scale.
      if (e.detail.causedBy === 'update' && Math.abs(scale - this.data.scale) >= 0.05) return
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

  /**
   * 冷启动、失败后返回、主动切入地图 Tab 时自动定位。
   * 已明确拒绝定位时保持现有地图视野，不在启动阶段反复弹窗打扰。
   */
  autoLocateOnEntry(refresh = false, manual = false) {
    if (this.checkinLocationRequested || this.data.isLocating || this.data.locationStatus === 'locating') return
    if (this.hasExplicitMapTarget && !refresh) return
    // 从详情返回保留查看中的地点。失败/拒绝不能当作“定位已完成”永久锁住。
    if (this.initialLocationStarted && this.data.hasLocationAuth && this.data.locationStatus === 'located' && !refresh) return
    this.hasExplicitMapTarget = false
    this.initialLocationStarted = true
    this.initialLocationResolved = false
    const intent = ++this.locationIntent
    this.setData({ locationStatus: 'locating' })
    wx.getSetting({
      success: ({ authSetting }) => {
        if (intent !== this.locationIntent) return
        if (authSetting['scope.userLocation'] === false) {
          this.setData({ hasLocationAuth: false, locationStatus: 'denied' })
          this.resolveInitialLocation(false)
          if (manual) this.showMapLocationPermissionGuide()
          return
        }
        if (authSetting['scope.userLocation'] === true) this.setData({ hasLocationAuth: true })
        this.requestInitialLocation(manual)
      },
      fail: () => {
        if (intent !== this.locationIntent) return
        this.requestInitialLocation(manual)
      },
    })
  },

  onLocate() {
    recordInteraction('map.locate')
    if (this.data.detailVisible) this.closeDetailSheet()
    this.autoLocateOnEntry(true, true)
  },

  showMapLocationPermissionGuide() {
    wx.showModal({
      title: '开启位置权限',
      content: '显示当前位置需要位置权限。开启后会自动定位，不会创建打卡记录。',
      confirmText: '去设置', cancelText: '暂不',
      success: ({ confirm }) => {
        if (!confirm) return
        wx.openSetting({
          success: ({ authSetting }) => {
            if (authSetting['scope.userLocation']) this.autoLocateOnEntry(true, true)
            else this.setData({ hasLocationAuth: false, locationStatus: 'denied' })
          },
        })
      },
    })
  },

  resolveInitialLocation(success: boolean) {
    if (this.initialLocationResolved) return
    this.initialLocationResolved = true
    if (!success && this.allFootprints.length) {
      this.fitToFootprints(this.computeModeView(this.data.mode).modeList)
    }
  },

  getCurrentLocation(): Promise<UserLocation> {
    if (this.locationPromise) return this.locationPromise
    const request = new Promise<UserLocation>((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        success: ({ latitude, longitude }) => resolve({ latitude, longitude }),
        fail: reject,
      })
    })
    this.locationPromise = request
    request.finally(() => {
      if (this.locationPromise === request) this.locationPromise = null
    }).catch(() => undefined)
    return request
  },

  requestInitialLocation(focusLighting = false) {
    if (this.initialLocationResolved) return
    const intent = this.locationIntent
    this.setData({ locationStatus: 'locating' })
    this.getCurrentLocation()
      .then(({ latitude, longitude }: UserLocation) => {
        // 用户已经主动发起快捷打卡时，由打卡流程独占本次定位结果和缩放级别。
        if (this.checkinLocationRequested || intent !== this.locationIntent) return
        this.resolveInitialLocation(true)
        this.setData({ locationStatus: 'located', hasLocationAuth: true })
        // 用户可能在异步定位完成前切到了想去或点亮；保留当前模式的目标视角。
        if (this.data.mode !== 'visited' && !focusLighting) return
        this.hasCenteredOnUser = true
        this.mapScale = USER_AREA_SCALE
        this.zoomTier = scaleToZoom(USER_AREA_SCALE)
        this.setData({
          center: { latitude, longitude },
          scale: USER_AREA_SCALE,
          hasLocationAuth: true,
          mapTilesReady: false,
          mapLoadFailed: false,
        }, () => {
          this.scheduleMapReadyFallback()
          // 原生地图可能仍停在手势拖动后的视角；经纬度未变化时 setData 不一定触发移动。
          if (this.mapReady) mapContext?.moveToLocation({ latitude, longitude })
        })
        this.refreshMarkers()
      })
      .catch((error: unknown) => {
        if (intent !== this.locationIntent) return
        this.setData({ locationStatus: 'failed' })
        this.resolveInitialLocation(false)
        // 自动定位失败时保留足迹视野；当前位置按钮提供独立重试入口。
        console.warn('[map] initial location unavailable', error)
      })
  },

  onCheckin() {
    recordInteraction('map.checkin')
    if (this.data.checkinPressed) this.setData({ checkinPressed: false })
    if (this.data.isLocating || this.data.checkinVisible || this.checkinNavigating) return
    this.checkinLocationRequested = true
    this.setData({ isLocating: true })
    wx.getSetting({
      success: ({ authSetting }) => {
        if (authSetting['scope.userLocation'] === false) {
          this.setData({ isLocating: false })
          this.showLocationPermissionGuide()
          return
        }
        this.requestCheckinLocation()
      },
      fail: () => this.requestCheckinLocation(),
    })
  },

  onCheckinPressStart() { this.setData({ checkinPressed: true }) },
  onCheckinPressEnd() { this.setData({ checkinPressed: false }) },

  async ensureFootprintsForCheckin() {
    try {
      if (this.initialDataPromise) await this.initialDataPromise
      // 有本地快照即可即时匹配；首次安装或缓存为空时再等待一次云端列表。
      if (this.allFootprints.length) return
      const profile = await loginForAccess()
      app.globalData.profile = profile
      if (!hasCloudAccess()) return
      const list = await listFootprints()
      if (this.isVisible) this.applyFootprints(list)
      else this.pendingFootprints = list
    } catch (error) {
      console.warn('[map] check-in footprints unavailable', error)
    }
  },

  async requestCheckinLocation() {
    wx.showLoading({ title: '正在准备打卡', mask: true })
    try {
      const res = await this.getCurrentLocation()
      this.resolveInitialLocation(true)
      this.hasCenteredOnUser = true
      this.mapScale = 16
      this.zoomTier = scaleToZoom(16)
      this.setData({
        center: { latitude: res.latitude, longitude: res.longitude },
        scale: 16,
        hasLocationAuth: true,
        locationStatus: 'located',
        mapTilesReady: false,
        mapLoadFailed: false,
      }, () => this.scheduleMapReadyFallback())
      this.refreshMarkers()

      await this.ensureFootprintsForCheckin()
      const candidate = findNearbyCheckinCandidate(
        res.latitude,
        res.longitude,
        this.allFootprints,
      )
      const distance = candidate ? Math.round(candidate.distance) : 0
      this.setData({
        checkinVisible: true,
        checkinCandidate: candidate,
        checkinDistance: distance,
      })
      this.syncTabBarForSheets()
    } catch {
      this.resolveInitialLocation(false)
      await new Promise<void>((resolve) => {
        wx.getSetting({
          success: ({ authSetting }) => {
            if (authSetting['scope.userLocation'] === false) {
              this.showLocationPermissionGuide()
            } else {
              wx.showToast({ title: '暂时无法定位，请检查系统定位', icon: 'none' })
            }
            resolve()
          },
          fail: () => {
            wx.showToast({ title: '暂时无法定位，请稍后重试', icon: 'none' })
            resolve()
          },
        })
      })
    } finally {
      this.checkinLocationRequested = false
      this.setData({ isLocating: false })
      wx.hideLoading()
    }
  },

  showLocationPermissionGuide() {
    wx.showModal({
      title: '开启位置权限',
      content: '快捷打卡需要读取当前位置。请在设置中允许位置信息后重试。',
      confirmText: '去设置',
      cancelText: '暂不',
      success: ({ confirm }) => {
        if (!confirm) {
          this.checkinLocationRequested = false
          this.resolveInitialLocation(false)
          return
        }
        wx.openSetting({
          success: ({ authSetting }) => {
            if (authSetting['scope.userLocation']) {
              this.checkinLocationRequested = true
              this.setData({ isLocating: true })
              this.requestCheckinLocation()
            } else {
              this.checkinLocationRequested = false
              this.resolveInitialLocation(false)
              wx.showToast({ title: '未开启位置权限', icon: 'none' })
            }
          },
          fail: () => {
            this.checkinLocationRequested = false
            this.resolveInitialLocation(false)
          },
        })
      },
    })
  },

  onCheckinClose() {
    this.closeCheckinSheet()
  },

  onCheckinConfirm() {
    const candidate = this.data.checkinCandidate
    if (!candidate || this.checkinNavigating) return
    this.checkinNavigating = true
    this.setData({ checkinVisible: false, checkinClosing: false })
    this.syncTabBarForSheets()
    wx.vibrateShort({ type: 'light', fail: () => {} })
    // 地图快照已包含打卡表单所需字段，先本地交接，避免进入表单后再阻塞等待云端详情。
    wx.setStorageSync(CHECKIN_SOURCE_STORAGE_KEY, candidate.footprint)
    wx.navigateTo({
      url: buildCheckinRoute(candidate),
      fail: () => {
        this.checkinNavigating = false
        wx.removeStorageSync(CHECKIN_SOURCE_STORAGE_KEY)
        this.setData({ checkinVisible: true })
        this.syncTabBarForSheets()
      },
    })
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
      fail: (error) => {
        this.setData({ checkinVisible: true })
        this.syncTabBarForSheets()
        if (!error.errMsg.includes('cancel')) wx.showToast({ title: '位置选择失败，请重试', icon: 'none' })
      },
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
    if (!id) return
    if (this.data.mode !== 'wishlist') {
      wx.navigateTo({ url: `/pages/footprint-form/index?id=${id}` })
      return
    }
    const fp = this.footprintsById[id]
    if (!fp) return
    const viewport = wishlistViewport(fp)
    if (!viewport) {
      wx.showModal({
        title: '补充地图位置',
        content: '这个地点还没有可确认的城市或地图坐标。补充位置后才能在地图上查看。',
        confirmText: '补位置',
        cancelText: '稍后',
        success: ({ confirm }) => { if (confirm) this.onUnplacedEdit(e) },
      })
      return
    }
    this.setData({ selectedWishlistId: id })
    this.mapScale = viewport.scale
    this.zoomTier = scaleToZoom(viewport.scale)
    this.refreshMarkers()
    this.setData({
      center: { latitude: viewport.latitude, longitude: viewport.longitude },
      scale: viewport.scale,
      mapTilesReady: false,
      mapLoadFailed: false,
    }, () => {
      this.scheduleMapReadyFallback()
      if (this.mapReady) mapContext?.moveToLocation({ latitude: viewport.latitude, longitude: viewport.longitude })
    })
  },

  onUnplacedEdit(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (id) wx.navigateTo({ url: `/pages/footprint-form/index?id=${id}` })
  },

  onUnplacedLoadMore() {
    this.unplacedLimit += 20
    this.setData({ unplacedFootprints: this.allUnplacedItems.slice(0, this.unplacedLimit) })
  },

  onClusterLoadMore() {
    this.clusterLimit += 20
    this.setData({ clusterItems: this.allClusterItems.slice(0, this.clusterLimit) })
  },

  onClusterClose() {
    this.setData({ clusterItems: [], clusterTotal: 0 })
  },

  onClusterItemTap(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    const fp = this.footprintsById[id]
    if (!fp) return
    this.setData({ clusterItems: [], clusterTotal: 0, selectedFootprint: fp, detailVisible: true, detailClosing: false })
    this.syncTabBarForSheets()
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
    if (this.emptyNavigating) return
    if (this.data.activeFilterCount) {
      this.applyFilter({}, { fit: true })
      return
    }
    this.emptyNavigating = true
    wx.navigateTo({
      url: this.data.mode === 'wishlist' ? '/pages/footprint-form/index?status=wishlist' : '/pages/city-stamp/index',
      complete: () => { setTimeout(() => { this.emptyNavigating = false }, 800) },
    })
  },

  preventMove() {},

  onUnload() {
    this.clearMapReadyFallback()
    if (this.detailCloseTimer) clearTimeout(this.detailCloseTimer)
    if (this.checkinCloseTimer) clearTimeout(this.checkinCloseTimer)
  },
})
