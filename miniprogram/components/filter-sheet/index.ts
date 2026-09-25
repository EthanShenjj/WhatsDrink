import type { FilterState } from '../../domain/types'
import { ALL_PROVINCES, citiesOfProvince } from '../../data/regions'
import { MOOD_OPTIONS, CATEGORY_OPTIONS } from '../../data/options'

const todayStr = (): string => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(visible: boolean) {
        if (visible) this.syncFromCurrent()
      },
    },
    currentFilter: {
      type: Object,
      value: {},
    },
    moods: {
      type: Array,
      value: [],
    },
    categories: {
      type: Array,
      value: [],
    },
  },
  data: {
    localFilter: {} as FilterState,
    provinces: ALL_PROVINCES,
    cities: [] as string[],
    provinceIndex: 0,
    cityIndex: 0,
    moodOptions: MOOD_OPTIONS,
    categoryOptions: CATEGORY_OPTIONS,
    today: todayStr(),
  },
  observers: {
    moods(moods: string[]) {
      const opts =
        moods && moods.length
          ? MOOD_OPTIONS.filter((m) => moods.includes(m.value))
          : MOOD_OPTIONS
      this.setData({ moodOptions: opts })
    },
    categories(cats: string[]) {
      const opts =
        cats && cats.length
          ? CATEGORY_OPTIONS.filter((c) => cats.includes(c.value))
          : CATEGORY_OPTIONS
      this.setData({ categoryOptions: opts })
    },
  },
  methods: {
    syncFromCurrent() {
      const f = { ...((this.data.currentFilter as FilterState) || {}) }
      const cities = f.province ? citiesOfProvince(f.province) : []
      const provinceIndex = f.province
        ? Math.max(0, ALL_PROVINCES.indexOf(f.province))
        : 0
      const cityIndex = f.city ? Math.max(0, cities.indexOf(f.city)) : 0
      this.setData({
        localFilter: f,
        cities,
        provinceIndex,
        cityIndex,
      })
    },
    onDateStartChange(
      e: WechatMiniprogram.CustomEvent<{ value: string }>,
    ) {
      this.setData({ 'localFilter.dateStart': e.detail.value })
    },
    onDateEndChange(
      e: WechatMiniprogram.CustomEvent<{ value: string }>,
    ) {
      this.setData({ 'localFilter.dateEnd': e.detail.value })
    },
    clearDate() {
      this.setData({
        'localFilter.dateStart': '',
        'localFilter.dateEnd': '',
      })
    },
    onProvinceChange(e: WechatMiniprogram.CustomEvent<{ value: number }>) {
      const province = this.data.provinces[e.detail.value] || ''
      const cities = province ? citiesOfProvince(province) : []
      this.setData({
        'localFilter.province': province,
        'localFilter.city': '',
        cities,
        provinceIndex: e.detail.value,
        cityIndex: 0,
      })
    },
    onCityChange(e: WechatMiniprogram.CustomEvent<{ value: number }>) {
      const city = this.data.cities[e.detail.value] || ''
      this.setData({
        'localFilter.city': city,
        cityIndex: e.detail.value,
      })
    },
    clearRegion() {
      this.setData({
        'localFilter.province': '',
        'localFilter.city': '',
        cities: [],
        provinceIndex: 0,
        cityIndex: 0,
      })
    },
    toggleCategory(e: WechatMiniprogram.TouchEvent) {
      const value = String(e.currentTarget.dataset.value)
      const current = this.data.localFilter.category
      this.setData({
        'localFilter.category': current === value ? '' : value,
      })
    },
    toggleMood(e: WechatMiniprogram.TouchEvent) {
      const value = String(e.currentTarget.dataset.value)
      const current = this.data.localFilter.mood
      this.setData({
        'localFilter.mood': current === value ? '' : value,
      })
    },
    apply() {
      this.triggerEvent('apply', { filter: this.data.localFilter })
    },
    reset() {
      this.setData({
        localFilter: {},
        cities: [],
        provinceIndex: 0,
        cityIndex: 0,
      })
      this.triggerEvent('reset')
    },
    close() {
      this.triggerEvent('close')
    },
    preventMove() {},
  },
})
