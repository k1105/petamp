import type { TrackPoint } from '../../types'

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

export function elevationLoss(points: TrackPoint[], threshold = 3): number {
  const smoothed = smoothAltitudes(points)
  let loss = 0
  for (let i = 1; i < smoothed.length; i++) {
    const prev = smoothed[i - 1]
    const curr = smoothed[i]
    if (prev === null || curr === null) continue
    const diff = prev - curr
    if (diff > threshold) loss += diff
  }
  return loss
}

/** Two-point initial bearing in degrees (0=N, 90=E). */
export function bearing(a: TrackPoint, b: TrackPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const dLng = toRad(b.lng - a.lng)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  const deg = (Math.atan2(y, x) * 180) / Math.PI
  return (deg + 360) % 360
}

/** Signed delta between two bearings in [-180, 180]. */
export function bearingDelta(b1: number, b2: number): number {
  let d = b2 - b1
  while (d > 180) d -= 360
  while (d < -180) d += 360
  return d
}

/** 2D segments の交点座標を返す。交差していなければ null。 */
export function segmentIntersectionPoint2D(
  a: [number, number], b: [number, number],
  c: [number, number], d: [number, number],
): [number, number] | null {
  const cross = (x1: number, y1: number, x2: number, y2: number) => x1 * y2 - y1 * x2
  const d1x = b[0] - a[0], d1y = b[1] - a[1]
  const d2x = d[0] - c[0], d2y = d[1] - c[1]
  const denom = cross(d1x, d1y, d2x, d2y)
  if (Math.abs(denom) < 1e-12) return null
  const t = cross(c[0] - a[0], c[1] - a[1], d2x, d2y) / denom
  const u = cross(c[0] - a[0], c[1] - a[1], d1x, d1y) / denom
  if (!(t > 0 && t < 1 && u > 0 && u < 1)) return null
  return [a[0] + t * d1x, a[1] + t * d1y]
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
