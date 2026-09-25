import type {
  Footprint,
  MapMode,
  MapSettings,
  FilterState,
  LightingStats,
  ClusterMarker,
  CityGrowth,
  MemoryDrop,
  GrowthSnapshot,
} from '../../domain/types'
import {
  listFootprints,
  loginForAccess,
  ensureProfile,
  getMapSettings,
  saveMapSettings,
} from '../../services/repository'
import { clusterFootprints, fitBounds, haversine } from '../../utils/map'
import { matchesFilter, computeLighting, computeCityGrowth, buildMemoryDrops, placeKey, usedMoods, usedCategories } from '../../utils/footprint'
import { todayKey } from '../../utils/date'
import { moodEmoji } from '../../data/options'
import { MAP_STYLE_IDS, MAP_STYLE_SUBKEY } from '../../services/config'
import { computeGrowthSnapshot } from '../../utils/growth'

interface MapMarker {
  id: number
  latitude: number
  longitude: number
  title: string
  width: number
  height: number
  iconPath: string
  callout: {
    content: string
    color: string
    fontSize: number
    bgColor: string
    padding: number
    borderRadius: number
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

interface GrowthCircle {
  latitude: number
  longitude: number
  radius: number
  color: string
  fillColor: string
  strokeWidth: number
}

interface PageData {
  mode: MapMode
  markers: MapMarker[]
  footprints: Footprint[]
  filteredFootprints: Footprint[]
  unplacedFootprints: Footprint[]
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
  center: { latitude: number; longitude: number }
  scale: number
  zoom: number
  lighting: LightingStats | null
  growthCities: CityGrowth[]
  growthCircles: GrowthCircle[]
  todayDrop: MemoryDrop | null
  nearbyMemory: Footprint | null
  nearbyDistance: number
  statusBarHeight: number
  tabReady: boolean
  markerIdMap: Record<number, string>
  clusterMarkers: Record<number, ClusterMarker>
  growth: GrowthSnapshot | null
}

const DEFAULT_CENTER = { latitude: 35.0, longitude: 105.0 }
const DEFAULT_SCALE = 4
const FOOTPRINT_CACHE_TTL = 60_000
const MAP_MODE_STORAGE_KEY = 'sgj:map-mode'

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
    width: 32,
    height: 40,
    iconPath: MARKER_ICON_BY_COLOR[(fp.status === 'fulfilled' ? '#F4B93F' : fp.markerStyle?.color || (isWishlist ? '#F4B93F' : '#5B6CFF')).toLowerCase()]
      || BRAND_MARKER_ICON,
    callout: {
      content: label,
      color: settings.theme === 'night' ? '#F7F8FF' : '#17182B',
      fontSize: 12,
      bgColor: settings.theme === 'night' ? '#17182B' : '#FFFFFF',
      padding: 8,
      borderRadius: 12,
      display: settings.markerStyle === 'label' && zoom >= 12 ? 'ALWAYS' : 'BYCLICK',
    },
    markerId: fp.id,
    isCluster: false,
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

Page<PageData, WechatMiniprogram.IAnyObject>({
  data: {
    mode: 'visited',
    markers: [],
    footprints: [],
    filteredFootprints: [],
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
    center: DEFAULT_CENTER,
    scale: DEFAULT_SCALE,
    zoom: DEFAULT_SCALE,
    lighting: null,
    growthCities: [],
    growthCircles: [],
    todayDrop: null,
    nearbyMemory: null,
    nearbyDistance: 0,
    statusBarHeight: 20,
    tabReady: false,
    markerIdMap: {},
    clusterMarkers: {},
    growth: null,
  },

  onLoad() {
    const sysInfo = wx.getWindowInfo()
    this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 })
    this.initData()
  },

  onShow() {
    const tabBar = this.getTabBar?.()
    if (tabBar) {
      tabBar.setData({ selected: 0 })
      this.setData({ tabReady: true })
    }
    const requestedMode = wx.getStorageSync<MapMode>(MAP_MODE_STORAGE_KEY)
    if (requestedMode === 'visited' || requestedMode === 'wishlist' || requestedMode === 'lighting') {
      wx.removeStorageSync(MAP_MODE_STORAGE_KEY)
      this.setData({ mode: requestedMode })
      this.updateModeView()
    }
    const settings = getMapSettings()
    this.setData({
      settings,
      clusterEnabled: settings.clusterEnabled,
      mapLayerStyle: MAP_STYLE_IDS[settings.theme],
    }, () => this.refreshFromCache())
  },

  onReady() {
    mapContext = wx.createMapContext('sgjMap', this)
  },

  async initData() {
    try {
      this.setData({ loading: true })
      await loginForAccess()
      const profile = await ensureProfile()
      app.globalData.profile = profile
      await this.loadFootprints(true)
    } catch (err) {
      console.warn('[map] init failed', err)
      this.setData({ loading: false, empty: true })
    }
  },

  async refreshFromCache() {
    const cachedAt = app.globalData.footprintsCachedAt || 0
    const isStale = Date.now() - cachedAt > FOOTPRINT_CACHE_TTL
    if (isStale) {
      await this.loadFootprints(false)
    } else {
      this.applyFootprints(app.globalData.footprints || [])
    }
  },

  async loadFootprints(showLoading: boolean) {
    if (showLoading) wx.showLoading({ title: '加载中', mask: true })
    try {
      const list = await listFootprints()
      app.globalData.footprints = list
      app.globalData.footprintsCachedAt = Date.now()
      this.applyFootprints(list)
    } catch (err) {
      console.warn('[map] load footprints failed', err)
      this.setData({ loading: false, empty: true })
    } finally {
      if (showLoading) wx.hideLoading()
    }
  },

  applyFootprints(list: Footprint[]) {
    const moods = usedMoods(list)
    const categories = usedCategories(list)
    const filtered = list.filter((fp) => matchesFilter(fp, this.data.currentFilter))
    const chips = filterChips(this.data.currentFilter)
    const growthCities = computeCityGrowth(list)
    const growthCircles: GrowthCircle[] = growthCities
      .filter((city) => typeof city.latitude === 'number' && typeof city.longitude === 'number')
      .map((city) => ({
        latitude: city.latitude!,
        longitude: city.longitude!,
        radius: city.level === 3 ? 30000 : city.level === 2 ? 18000 : 8000,
        color: city.level === 3 ? '#3E47C899' : '#5B6CFF80',
        fillColor: city.level === 3 ? '#5B6CFF66' : city.level === 2 ? '#5B6CFF44' : '#5B6CFF2E',
        strokeWidth: city.level === 3 ? 3 : 1,
      }))
    this.setData({
      footprints: list,
      filteredFootprints: filtered,
      moods,
      categories,
      lighting: computeLighting(filtered),
      growthCities,
      growthCircles,
      todayDrop: buildMemoryDrops(list, todayKey(), 1)[0] || null,
      loading: false,
      empty: list.length === 0,
      activeFilterCount: chips.length,
      activeFilterChips: chips,
      growth: computeGrowthSnapshot(list, app.globalData.profile),
    })
    this.updateModeView()
  },

  updateModeView() {
    const { mode, filteredFootprints } = this.data
    const modeList = filteredFootprints.filter((fp) =>
      mode === 'wishlist' ? fp.status !== 'visited' : fp.status === 'visited',
    )
    const copy = modeCopy(mode)
    const unplacedFootprints = modeList.filter(
      (fp) => typeof fp.lat !== 'number' || typeof fp.lng !== 'number',
    )
    this.setData({
      modeEmpty: modeList.length === 0,
      unplacedFootprints,
      modeEmptyTitle: copy.title,
      modeEmptyDescription: copy.description,
      lighting: computeLighting(filteredFootprints),
    })
    this.renderMarkers()
    this.fitToFootprints(modeList)
  },

  renderMarkers() {
    const { mode, filteredFootprints, clusterEnabled, zoom, settings } = this.data
    if (mode === 'lighting') {
      this.setData({ markers: [], markerIdMap: {}, clusterMarkers: {} })
      return
    }

    const target = filteredFootprints.filter((fp) => {
      if (mode === 'visited') return fp.status === 'visited'
      if (mode === 'wishlist') return fp.status !== 'visited'
      return true
    })

    const validForMap = target.filter(
      (fp) => typeof fp.lat === 'number' && typeof fp.lng === 'number',
    )

    // 同一 POI 可有多次到访，但地图默认只显示一个点。
    const visitCounts: Record<string, number> = {}
    const placeMap = new Map<string, Footprint>()
    for (const fp of validForMap) {
      const key = placeKey(fp)
      visitCounts[fp.id] = (visitCounts[fp.id] || 0) + 1
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
    if (clusterEnabled && zoom < 14) {
      items = clusterFootprints(mapFootprints, zoom)
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
        markers.push(buildMarker(fp, id, mode, settings, zoom, visitCounts[fp.id] || 1))
      }
    })

    this.setData({ markers, markerIdMap, clusterMarkers })
  },

  fitToFootprints(list: Footprint[]) {
    const target = list.filter(
      (fp) => typeof fp.lat === 'number' && typeof fp.lng === 'number',
    )
    if (!target.length) {
      this.setData({ center: DEFAULT_CENTER, scale: DEFAULT_SCALE, zoom: DEFAULT_SCALE })
      return
    }
    const { latitude, longitude, scale } = fitBounds(target)
    this.setData({ center: { latitude, longitude }, scale, zoom: scaleToZoom(scale) })
  },

  onModeTap(e: WechatMiniprogram.TouchEvent) {
    const mode = e.currentTarget.dataset.mode as MapMode
    if (mode === this.data.mode) return
    this.setData({ mode, detailVisible: false, selectedFootprint: null })
    this.updateModeView()
  },

  onMarkerTap(
    e: WechatMiniprogram.CustomEvent<{ markerId: number }>,
  ) {
    const markerId = e.detail.markerId
    const { markerIdMap, clusterMarkers, footprints } = this.data
    const cluster = clusterMarkers[markerId]
    if (cluster) {
      const nextScale = Math.min(this.data.scale + 3, 18)
      this.setData({
        center: { latitude: cluster.latitude, longitude: cluster.longitude },
        scale: nextScale,
        zoom: scaleToZoom(nextScale),
      })
      this.renderMarkers()
      return
    }
    const footprintId = markerIdMap[markerId]
    if (!footprintId) return
    const fp = footprints.find((f) => f.id === footprintId)
    if (!fp) return
    this.setData({ selectedFootprint: fp, detailVisible: true })
  },

  onMapTap() {
    if (this.data.detailVisible) {
      this.setData({ detailVisible: false, selectedFootprint: null })
    }
  },

  onRegionChange(
    e: WechatMiniprogram.CustomEvent<{ type: 'begin' | 'end'; scale?: number }>,
  ) {
    if (e.detail.type !== 'end') return
    const updateScale = (scale: number) => {
      const newZoom = scaleToZoom(scale)
      if (Math.abs(newZoom - this.data.zoom) >= 1) {
        this.setData({ scale, zoom: newZoom })
        this.renderMarkers()
      } else {
        this.setData({ scale })
      }
    }
    if (typeof e.detail.scale === 'number') updateScale(e.detail.scale)
    else mapContext?.getScale({ success: ({ scale }) => updateScale(scale) })
  },

  onLocate() {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        const nearby = this.data.footprints
          .filter((fp) => fp.status === 'visited' && typeof fp.lat === 'number' && typeof fp.lng === 'number')
          .map((fp) => ({ fp, distance: haversine(res.latitude, res.longitude, fp.lat!, fp.lng!) }))
          .filter((item) => item.distance <= 1000)
          .sort((a, b) => a.distance - b.distance)[0]
        this.setData({
          center: { latitude: res.latitude, longitude: res.longitude },
          scale: 16,
          zoom: 14,
          hasLocationAuth: true,
          nearbyMemory: nearby?.fp || null,
          nearbyDistance: nearby ? Math.round(nearby.distance) : 0,
        })
        mapContext?.moveToLocation({
          latitude: res.latitude,
          longitude: res.longitude,
        })
      },
      fail: () => {
        wx.showToast({ title: '请授权位置信息', icon: 'none' })
      },
    })
  },

  onMemoryCueTap() {
    const id = this.data.nearbyMemory?.id || this.data.todayDrop?.footprint.id
    if (id) wx.navigateTo({ url: `/pages/footprint-detail/index?id=${id}` })
  },

  onSearch() {
    wx.chooseLocation({
      success: (res) => {
        const status = this.data.mode === 'wishlist' ? 'wishlist' : 'visited'
        const draft = {
          poiName: res.name || '未命名地点',
          address: res.address,
          lat: res.latitude,
          lng: res.longitude,
          visitDate: status === 'visited' ? todayKey() : undefined,
          status,
          photos: [] as string[],
          tags: [] as string[],
          visibility: 'private' as const,
          source: 'manual' as const,
        }
        wx.setStorageSync('sgj:quick-place', draft)
        wx.navigateTo({ url: `/pages/footprint-form/index?from=place&status=${status}` })
      },
      fail: () => {},
    })
  },

  onFilter() {
    this.setData({ filterVisible: true })
  },

  onSettings() {
    wx.navigateTo({ url: '/pages/settings/index' })
  },

  onShare() {
    wx.setStorageSync('sgj:share-map-ids', this.data.filteredFootprints.map((fp) => fp.id))
    wx.navigateTo({ url: `/pages/share-card/index?type=map&mode=${this.data.mode}` })
  },

  onFilterApply(e: WechatMiniprogram.CustomEvent<{ filter: FilterState }>) {
    const filter = e.detail.filter || {}
    const filtered = this.data.footprints.filter((fp) => matchesFilter(fp, filter))
    const chips = filterChips(filter)
    this.setData({
      currentFilter: filter,
      filteredFootprints: filtered,
      filterVisible: false,
      activeFilterCount: chips.length,
      activeFilterChips: chips,
    })
    this.updateModeView()
  },

  onFilterReset() {
    this.setData({
      currentFilter: {},
      filteredFootprints: this.data.footprints,
      filterVisible: false,
      activeFilterCount: 0,
      activeFilterChips: [],
    })
    this.updateModeView()
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
    const filtered = this.data.footprints.filter((fp) => matchesFilter(fp, next))
    const chips = filterChips(next)
    this.setData({
      currentFilter: next,
      filteredFootprints: filtered,
      activeFilterCount: chips.length,
      activeFilterChips: chips,
    })
    this.updateModeView()
  },

  onFilterClose() {
    this.setData({ filterVisible: false })
  },

  onMapControlClusterToggle(
    e: WechatMiniprogram.CustomEvent<{ enabled: boolean }>,
  ) {
    const enabled = Boolean(e.detail?.enabled)
    const settings: MapSettings = { ...this.data.settings, clusterEnabled: enabled }
    saveMapSettings(settings)
    this.setData({ settings, clusterEnabled: enabled })
    this.renderMarkers()
  },

  onGrowthTap() {
    wx.navigateTo({ url: '/pages/growth/index' })
  },

  onDetailTap() {
    const fp = this.data.selectedFootprint
    if (!fp) return
    wx.navigateTo({ url: `/pages/footprint-detail/index?id=${fp.id}` })
  },

  onUnplacedTap(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const id = e.detail.id
    if (id) wx.navigateTo({ url: `/pages/footprint-detail/index?id=${id}` })
  },

  onDetailClose() {
    this.setData({ detailVisible: false, selectedFootprint: null })
  },

  onEmptyAction() {
    const status = this.data.mode === 'wishlist' ? 'wishlist' : 'visited'
    wx.navigateTo({ url: `/pages/footprint-form/index?status=${status}` })
  },

  onLightingExplore() {
    this.onShare()
  },

  preventMove() {},
})
