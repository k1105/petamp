import type { TrackPoint } from '../types'

export function haversineDistance(a: TrackPoint, b: TrackPoint): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sin2 = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(sin2))
}

export function totalDistance(points: TrackPoint[]): number {
  let dist = 0
  for (let i = 1; i < points.length; i++) {
    dist += haversineDistance(points[i - 1], points[i])
  }
  return dist
}

export function smoothAltitudes(points: TrackPoint[], windowSize = 5): (number | null)[] {
  return points.map((_, i) => {
    const window = points.slice(Math.max(0, i - windowSize + 1), i + 1)
    const withAlt = window.filter(p => p.altitude !== null)
    if (withAlt.length === 0) return null
    return withAlt.reduce((sum, p) => sum + p.altitude!, 0) / withAlt.length
  })
}

export function elevationGain(points: TrackPoint[], threshold = 3): number {
  const smoothed = smoothAltitudes(points)
  let gain = 0
  for (let i = 1; i < smoothed.length; i++) {
    const prev = smoothed[i - 1]
    const curr = smoothed[i]
    if (prev === null || curr === null) continue
    const diff = curr - prev
    if (diff > threshold) gain += diff
  }
  return gain
}

export function qualifyAltitude(
  altitude: number | null,
  altitudeAccuracy: number | null | undefined,
  maxAccuracy = 20,
): number | null {
  if (altitude === null) return null
  if (altitudeAccuracy === null || altitudeAccuracy === undefined) return null
  return altitudeAccuracy <= maxAccuracy ? altitude : null
}
