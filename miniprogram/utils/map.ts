import type { Footprint, ClusterMarker } from '../domain/types'

const EARTH_RADIUS = 6378137
const MAX_LAT = 85.0511

const toRad = (deg: number): number => (deg * Math.PI) / 180

export const haversine = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number => {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const latToPixel = (lat: number, zoom: number): number => {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))
  return (
    ((1 + Math.log(Math.tan(toRad(clamped)) + 1 / Math.cos(toRad(clamped))) / Math.PI) /
      2) *
    Math.pow(2, zoom) *
    256
  )
}

const lngToPixel = (lng: number, zoom: number): number =>
  ((lng + 180) / 360) * Math.pow(2, zoom) * 256

const longitudeArc = (longitudes: number[]): { center: number; span: number } => {
  const sorted = longitudes.map((lng) => ((lng + 180) % 360 + 360) % 360).sort((a, b) => a - b)
  let largestGap = -1
  let gapStart = 0
  for (let index = 0; index < sorted.length; index += 1) {
    const next = index + 1 < sorted.length ? sorted[index + 1] : sorted[0] + 360
    const gap = next - sorted[index]
    if (gap > largestGap) {
      largestGap = gap
      gapStart = index
    }
  }
  const span = 360 - largestGap
  const arcStart = sorted[(gapStart + 1) % sorted.length]
  const center = ((arcStart + span / 2) % 360) - 180
  return { center, span }
}

export const clusterFootprints = (
  footprints: Footprint[],
  zoom: number,
  gridSize = 60,
): Array<Footprint | ClusterMarker> => {
  const valid = footprints.filter(
    (fp) => typeof fp.lat === 'number' && typeof fp.lng === 'number',
  )
  if (valid.length <= 1) return valid

  interface Point {
    id: string
    x: number
    y: number
    fp: Footprint
  }
  // 网格桶索引：桶宽即聚合半径，近邻只可能落在所在桶及相邻 8 桶内，
  // 每点不再全量扫描其余点（O(n²) → O(n·桶均摊)）。
  const buckets = new Map<string, Point[]>()
  const points: Point[] = valid.map((fp) => {
    const point: Point = {
      id: fp.id,
      x: lngToPixel(fp.lng!, zoom),
      y: latToPixel(fp.lat!, zoom),
      fp,
    }
    const key = `${Math.floor(point.x / gridSize)}:${Math.floor(point.y / gridSize)}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(point)
    else buckets.set(key, [point])
    return point
  })

  const clusters: ClusterMarker[] = []
  const visited = new Set<string>()

  for (const current of points) {
    if (visited.has(current.id)) continue
    const col = Math.floor(current.x / gridSize)
    const row = Math.floor(current.y / gridSize)
    const nearby: Point[] = []
    for (let dCol = -1; dCol <= 1; dCol += 1) {
      for (let dRow = -1; dRow <= 1; dRow += 1) {
        const bucket = buckets.get(`${col + dCol}:${row + dRow}`)
        if (!bucket) continue
        for (const other of bucket) {
          if (
            !visited.has(other.id) &&
            Math.abs(other.x - current.x) < gridSize &&
            Math.abs(other.y - current.y) < gridSize
          ) {
            nearby.push(other)
          }
        }
      }
    }
    if (nearby.length === 1) {
      visited.add(current.id)
      continue
    }

    for (const n of nearby) visited.add(n.id)

    if (nearby.length <= 3) {
      continue
    }

    const sumLat = nearby.reduce((s, n) => s + n.fp.lat!, 0)
    const sumLng = nearby.reduce((s, n) => s + n.fp.lng!, 0)
    clusters.push({
      id: clusters.length,
      latitude: sumLat / nearby.length,
      longitude: sumLng / nearby.length,
      count: nearby.length,
      footprintIds: nearby.map((n) => n.id),
    })
  }

  const clustered = new Set(clusters.flatMap((c) => c.footprintIds))
  const standalone = valid.filter((fp) => !clustered.has(fp.id))
  return [...standalone, ...clusters]
}

export const fitBounds = (
  footprints: Footprint[],
): { latitude: number; longitude: number; scale: number } => {
  const valid = footprints.filter(
    (fp) => typeof fp.lat === 'number' && typeof fp.lng === 'number',
  )
  if (valid.length === 0) {
    return { latitude: 35.0, longitude: 105.0, scale: 4 }
  }
  if (valid.length === 1) {
    return { latitude: valid[0].lat!, longitude: valid[0].lng!, scale: 16 }
  }
  const lats = valid.map((fp) => fp.lat!)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const centerLat = (minLat + maxLat) / 2
  const { center: centerLng, span: lngSpan } = longitudeArc(valid.map((fp) => fp.lng!))
  const latSpan = maxLat - minLat
  const maxSpan = Math.max(latSpan, lngSpan)
  let scale = 16
  if (maxSpan > 40) scale = 3
  else if (maxSpan > 20) scale = 4
  else if (maxSpan > 10) scale = 5
  else if (maxSpan > 5) scale = 6
  else if (maxSpan > 2) scale = 8
  else if (maxSpan > 1) scale = 10
  else if (maxSpan > 0.3) scale = 12
  else if (maxSpan > 0.1) scale = 14
  return { latitude: centerLat, longitude: centerLng, scale }
}

export const formatCoord = (lat: number, lng: number): string =>
  `${lat.toFixed(6)}, ${lng.toFixed(6)}`
