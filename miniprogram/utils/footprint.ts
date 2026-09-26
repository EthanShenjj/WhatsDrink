import type { Footprint, FootprintDraft, LightingStats, FilterState, CityGrowth, MemoryDrop } from '../domain/types'
import { dateKey } from './date'

export const matchesFilter = (fp: Footprint, filter: FilterState): boolean => {
  if (filter.dateStart && (!fp.visitDate || fp.visitDate < filter.dateStart)) return false
  if (filter.dateEnd && (!fp.visitDate || fp.visitDate > filter.dateEnd)) return false
  if (filter.country && fp.country !== filter.country) return false
  if (filter.province && fp.province !== filter.province) return false
  if (filter.city && fp.city !== filter.city) return false
  if (filter.category && fp.category !== filter.category) return false
  if (filter.mood && fp.mood !== filter.mood) return false
  return true
}

export const computeLighting = (footprints: Footprint[]): LightingStats => {
  const visited = footprints.filter((fp) => fp.status === 'visited')
  const wishlist = footprints.filter((fp) => fp.status === 'wishlist')
  const fulfilled = footprints.filter((fp) => fp.status === 'fulfilled')
  const countries = new Set(visited.map((fp) => fp.country).filter(Boolean))
  const provinces = new Set(visited.map((fp) => fp.province).filter(Boolean))
  const cities = new Set(visited.filter((fp) => fp.city).map((fp) => `${fp.province || ''}/${fp.city}`))
  const places = new Set(visited.map(placeKey))
  const legacyFulfilled = new Set(visited.filter((fp) => fp.convertedFromWishlist && !fp.wishId).map((fp) => fp.id))
  const photoCount = visited.reduce((sum, fp) => sum + fp.photos.length, 0)
  return {
    countries: countries.size,
    provinces: provinces.size,
    cities: cities.size,
    places: places.size,
    visitedCount: visited.length,
    wishlistCount: wishlist.length,
    fulfilledWishCount: fulfilled.length + legacyFulfilled.size,
    photoCount,
    litProvinces: [...provinces] as string[],
    litCities: [...new Set(visited.map((fp) => fp.city).filter(Boolean))] as string[],
  }
}

export const placeKey = (fp: Pick<Footprint, 'placeId' | 'poiName' | 'city' | 'province' | 'address' | 'lat' | 'lng'>): string => {
  if (fp.placeId) return fp.placeId
  const name = fp.poiName.trim().toLowerCase()
  const area = `${fp.province || ''}/${fp.city || ''}`.toLowerCase()
  if (typeof fp.lat === 'number' && typeof fp.lng === 'number') {
    return `${area}/${name}/${fp.lat.toFixed(4)}/${fp.lng.toFixed(4)}`
  }
  return `${area}/${name}/${(fp.address || '').trim().toLowerCase()}`
}

export const visitsAtPlace = (footprints: Footprint[], place: Footprint): Footprint[] =>
  sortByVisitDate(footprints.filter((fp) => fp.status === 'visited' && placeKey(fp) === placeKey(place)))

export const computeCityGrowth = (footprints: Footprint[]): CityGrowth[] => {
  const cities = new Map<string, { city: string; province?: string; places: Set<string>; coords: Map<string, [number, number]> }>()
  for (const fp of footprints) {
    if (fp.status !== 'visited' || !fp.city) continue
    const key = `${fp.province || fp.country || ''}/${fp.city}`
    const item = cities.get(key) || { city: fp.city, province: fp.province, places: new Set<string>(), coords: new Map<string, [number, number]>() }
    const place = placeKey(fp)
    item.places.add(place)
    if (typeof fp.lat === 'number' && typeof fp.lng === 'number' && !item.coords.has(place)) item.coords.set(place, [fp.lat, fp.lng])
    cities.set(key, item)
  }
  return [...cities.entries()].map(([key, item]) => {
    const count = item.places.size
    const level: CityGrowth['level'] = count >= 10 ? 3 : count >= 3 ? 2 : 1
    const coords = [...item.coords.values()]
    return {
      key,
      city: item.city,
      province: item.province,
      places: count,
      level,
      latitude: coords.length ? coords.reduce((sum, pair) => sum + pair[0], 0) / coords.length : undefined,
      longitude: coords.length ? coords.reduce((sum, pair) => sum + pair[1], 0) / coords.length : undefined,
    }
  }).sort((a, b) => b.level - a.level || b.places - a.places)
}

export const buildMemoryDrops = (footprints: Footprint[], today: string, limit = 3): MemoryDrop[] => {
  const now = new Date(`${today}T12:00:00`)
  const dailyRank = (id: string): number => {
    let hash = 2166136261
    for (const char of `${today}:${id}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
    return hash >>> 0
  }
  const historical = footprints.filter((fp) => fp.status === 'visited' && fp.visitDate && fp.visitDate < today)
  const anniversaries = historical
    .filter((fp) => fp.visitDate!.slice(5) === today.slice(5))
    .sort((a, b) => b.visitDate!.localeCompare(a.visitDate!))
    .map((fp) => ({ id: fp.id, footprint: fp, kind: 'anniversary' as const, title: `${Number(today.slice(0, 4)) - Number(fp.visitDate!.slice(0, 4))} 年前的今天，你在 ${fp.poiName}` }))
  const recent = historical
    .filter((fp) => {
      const age = (now.getTime() - new Date(`${fp.visitDate}T12:00:00`).getTime()) / 86_400_000
      return age > 0 && age <= 30 && fp.visitDate!.slice(5) !== today.slice(5)
    })
    .sort((a, b) => dailyRank(a.id) - dailyRank(b.id) || a.id.localeCompare(b.id))
    .map((fp) => ({ id: fp.id, footprint: fp, kind: 'recent' as const, title: `前些天在 ${fp.poiName}，你留下了这段回忆` }))
  return [...anniversaries, ...recent].slice(0, limit)
}

export const groupByDate = (footprints: Footprint[]): Map<string, Footprint[]> => {
  const map = new Map<string, Footprint[]>()
  for (const fp of footprints) {
    const key = fp.visitDate || dateKey(fp.createdAt)
    const list = map.get(key) || []
    list.push(fp)
    map.set(key, list)
  }
  return map
}

export const groupByPoi = (footprints: Footprint[]): Map<string, Footprint[]> => {
  const map = new Map<string, Footprint[]>()
  for (const fp of footprints) {
    const key = placeKey(fp)
    const list = map.get(key) || []
    list.push(fp)
    map.set(key, list)
  }
  return map
}

export const sortByVisitDate = (footprints: Footprint[]): Footprint[] =>
  [...footprints].sort((a, b) => {
    const da = a.visitDate || dateKey(a.createdAt)
    const db = b.visitDate || dateKey(b.createdAt)
    return db.localeCompare(da)
  })

export const sortByCreatedDesc = (footprints: Footprint[]): Footprint[] =>
  [...footprints].sort((a, b) => b.createdAt - a.createdAt)

export const createDefaultFootprint = (
  overrides: Partial<FootprintDraft> = {},
): FootprintDraft => ({
  status: 'visited',
  poiName: '',
  photos: [],
  tags: [],
  source: 'manual',
  visitDate: dateKey(new Date()),
  ...overrides,
})

export const usedMoods = (footprints: Footprint[]): string[] => {
  const set = new Set<string>()
  for (const fp of footprints) {
    if (fp.mood) set.add(fp.mood)
  }
  return [...set]
}

export const usedCategories = (footprints: Footprint[]): string[] => {
  const set = new Set<string>()
  for (const fp of footprints) {
    if (fp.category) set.add(fp.category)
  }
  return [...set]
}
