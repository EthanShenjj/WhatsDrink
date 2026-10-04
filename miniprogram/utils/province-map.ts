import boundaries from '../data/province-boundaries'
import type { Footprint } from '../domain/types'
import { placeKey } from './footprint'

type Coordinate = [number, number] // [longitude, latitude]
type BoundaryData = Record<string, Coordinate[][]>

export interface ProvincePolygon {
  points: Array<{ latitude: number; longitude: number }>
  fillColor: string
  strokeColor: string
  strokeWidth: number
  zIndex: number
  level: 'aboveroads'
}

export interface ProvinceMemory {
  id: string
  poiName: string
  date: string
  photo: string
}

export interface ProvinceOverview {
  name: string
  places: number
  visits: number
  cities: number
  cityNames: string[]
  photos: number
  memories: ProvinceMemory[]
}

const provinceBoundaries = boundaries as unknown as BoundaryData
const provinceNames = Object.keys(provinceBoundaries)
const FILL_COLORS = ['#5B6CFF', '#5C9FBB', '#B681D8', '#D69B67', '#73A984']
const indexedRings = provinceNames.map((name) => ({
  name,
  rings: provinceBoundaries[name].map((ring) => ({
    ring,
    minLng: Math.min(...ring.map(([lng]) => lng)),
    maxLng: Math.max(...ring.map(([lng]) => lng)),
    minLat: Math.min(...ring.map(([, lat]) => lat)),
    maxLat: Math.max(...ring.map(([, lat]) => lat)),
  })),
}))

export const normalizeProvince = (name: string): string =>
  (name || '').trim().replace(/(特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|省|市)$/, '')

export const resolveProvince = (name: string): string | undefined => {
  const normalized = normalizeProvince(name)
  return provinceNames.find((item) => normalizeProvince(item) === normalized)
}

export const provinceOverviews = (footprints: Footprint[]): ProvinceOverview[] => {
  const groups = new Map<string, Footprint[]>()
  for (const fp of footprints) {
    if (fp.status !== 'visited') continue
    // wx.chooseLocation supplies coordinates and address but no province field.
    // Resolve old and new records by coordinates when that field is absent.
    const name = resolveProvince(fp.province || '') || (
      typeof fp.lat === 'number' && typeof fp.lng === 'number'
        ? provinceAt(fp.lat, fp.lng)
        : undefined
    )
    if (!name) continue
    const group = groups.get(name) || []
    group.push(fp)
    groups.set(name, group)
  }
  return [...groups.entries()].map(([name, records]) => ({
    name,
    places: new Set(records.filter((fp) => fp.recordLevel !== 'city').map(placeKey)).size,
    visits: records.filter((fp) => fp.recordLevel !== 'city').length,
    cities: new Set(records.map((fp) => fp.city).filter(Boolean)).size,
    cityNames: [...new Set(records.map((fp) => fp.city).filter((city): city is string => Boolean(city)))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    photos: records.filter((fp) => fp.recordLevel !== 'city').reduce((sum, fp) => sum + (fp.photoCount ?? fp.photos.length), 0),
    memories: [...records.filter((fp) => fp.recordLevel !== 'city')]
      .sort((a, b) => (b.visitDate || '').localeCompare(a.visitDate || ''))
      .slice(0, 3)
      .map((fp) => ({
        id: fp.id,
        poiName: fp.poiName,
        date: fp.visitDate || '',
        photo: fp.photoThumbs?.[0] || fp.photos?.[0] || '',
      })),
  })).sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name, 'zh-CN'))
}

export const buildProvincePolygons = (litNames: string[], selectedName = ''): ProvincePolygon[] => {
  const lit = new Set(litNames.map(resolveProvince).filter((name): name is string => Boolean(name)))
  const selected = resolveProvince(selectedName)
  const polygons: ProvincePolygon[] = []
  for (const name of provinceNames) {
    if (!lit.has(name) && name !== selected) continue
    const color = FILL_COLORS[provinceNames.indexOf(name) % FILL_COLORS.length]
    const active = name === selected
    for (const ring of provinceBoundaries[name]) {
      polygons.push({
        points: ring.map(([longitude, latitude]) => ({ latitude, longitude })),
        fillColor: lit.has(name) ? `${color}${active ? '99' : '66'}` : '#5B6CFF22',
        strokeColor: active ? '#404FDFFF' : `${color}CC`,
        strokeWidth: active ? 3 : 2,
        zIndex: active ? 2 : 1,
        level: 'aboveroads',
      })
    }
  }
  return polygons
}

const isInsideRing = (longitude: number, latitude: number, ring: Coordinate[]): boolean => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > latitude) !== (yj > latitude)
      && longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export const provinceAt = (latitude: number, longitude: number): string | undefined => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined
  return indexedRings.find(({ rings }) => rings.some(({ ring, minLng, maxLng, minLat, maxLat }) =>
    longitude >= minLng && longitude <= maxLng && latitude >= minLat && latitude <= maxLat
      && isInsideRing(longitude, latitude, ring),
  ))?.name
}

export const provinceViewport = (name: string): { latitude: number; longitude: number; scale: number } | undefined => {
  const resolved = resolveProvince(name)
  if (!resolved) return undefined
  const coordinates = provinceBoundaries[resolved].flat()
  const lngs = coordinates.map(([lng]) => lng)
  const lats = coordinates.map(([, lat]) => lat)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const span = Math.max(maxLng - minLng, maxLat - minLat)
  return {
    longitude: (minLng + maxLng) / 2,
    latitude: (minLat + maxLat) / 2,
    scale: span > 13 ? 4 : span > 7 ? 5 : span > 3 ? 6 : span > 1 ? 7 : 9,
  }
}
