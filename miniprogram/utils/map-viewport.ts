import type { ClusterMarker, Footprint } from '../domain/types'

export interface MapViewport {
  northeast: { latitude: number; longitude: number }
  southwest: { latitude: number; longitude: number }
}

type MapPoint = Footprint | ClusterMarker
const isCluster = (item: MapPoint): item is ClusterMarker => 'footprintIds' in item
const longitudeFrom = (west: number, longitude: number): number => ((longitude - west) % 360 + 360) % 360
const latitudeOf = (item: MapPoint): number => isCluster(item) ? item.latitude : item.lat!
const longitudeOf = (item: MapPoint): number => isCluster(item) ? item.longitude : item.lng!

/** 跨日期变更线时也保留视野边缘 20% 的缓冲，减少小幅拖动后的反复提交。 */
export const inMapViewport = (latitude: number, longitude: number, viewport: MapViewport): boolean => {
  const south = viewport.southwest.latitude
  const north = viewport.northeast.latitude
  const latPadding = Math.max((north - south) * 0.2, 0.001)
  const west = viewport.southwest.longitude
  const width = viewport.northeast.longitude - west >= 359
    ? 360 : longitudeFrom(west, viewport.northeast.longitude)
  const longitudePadding = Math.max(width * 0.2, 0.001)
  const x = longitudeFrom(west, longitude)
  return latitude >= south - latPadding && latitude <= north + latPadding
    && (width >= 359 || x <= width + longitudePadding || x >= 360 - longitudePadding)
}

export const visibleMapItems = <T extends MapPoint>(items: T[], viewport: MapViewport | null): T[] =>
  viewport ? items.filter((item) => inMapViewport(latitudeOf(item), longitudeOf(item), viewport)) : items

/** 超出原生地图预算时按视野网格聚合；聚合项保留全部原始 ID。 */
export const budgetMapItems = (items: MapPoint[], maxMarkers = 200): MapPoint[] => {
  if (items.length <= maxMarkers) return items
  const minLat = Math.min(...items.map(latitudeOf))
  const maxLat = Math.max(...items.map(latitudeOf))
  const west = longitudeOf(items[0])
  const xs = items.map((item) => longitudeFrom(west, longitudeOf(item)))
  const maxX = Math.max(...xs)
  // 14 × 14 <= 200。极密集的地点会落到同一格，仍能从聚合列表进入。
  const side = Math.max(1, Math.floor(Math.sqrt(maxMarkers)))
  const buckets = new Map<string, MapPoint[]>()
  items.forEach((item, index) => {
    const row = Math.min(side - 1, Math.floor((latitudeOf(item) - minLat) / Math.max(maxLat - minLat, 0.000001) * side))
    const col = Math.min(side - 1, Math.floor(xs[index] / Math.max(maxX, 0.000001) * side))
    const key = `${row}:${col}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  })
  return [...buckets.values()].map((bucket, index) => {
    if (bucket.length === 1) return bucket[0]
    const footprintIds = bucket.flatMap((item) => isCluster(item) ? item.footprintIds : [item.id])
    return {
      id: index,
      latitude: latitudeOf(bucket[0]),
      longitude: longitudeOf(bucket[0]),
      count: footprintIds.length,
      footprintIds,
    }
  })
}
