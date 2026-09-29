import type { Footprint } from '../domain/types'
import { haversine } from './map'

export interface CheckinCandidate {
  footprint: Footprint
  distance: number
  action: 'revisit' | 'fulfill'
}

export const buildCheckinRoute = (candidate: CheckinCandidate): string => {
  const distance = Math.round(candidate.distance)
  const source = candidate.action === 'fulfill'
    ? `id=${encodeURIComponent(candidate.footprint.id)}&convert=1`
    : `revisit=${encodeURIComponent(candidate.footprint.id)}`
  return `/pages/footprint-form/index?${source}&checkin=1&distance=${distance}`
}

export const findNearbyCheckinCandidate = (
  latitude: number,
  longitude: number,
  footprints: Footprint[],
  maxDistance = 1000,
): CheckinCandidate | null => {
  const candidates = footprints
    .filter((footprint) => (
      (footprint.status === 'visited' || footprint.status === 'wishlist')
      && typeof footprint.lat === 'number'
      && typeof footprint.lng === 'number'
    ))
    .map((footprint) => ({
      footprint,
      distance: haversine(latitude, longitude, footprint.lat!, footprint.lng!),
      action: footprint.status === 'wishlist' ? 'fulfill' as const : 'revisit' as const,
    }))
    .filter((candidate) => candidate.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)

  return candidates[0] || null
}
