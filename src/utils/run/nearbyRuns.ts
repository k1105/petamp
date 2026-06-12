import type { Run } from '../../types'
import { acceptedPoints } from '../geo/recordingFilters'
import { haversineDistance } from '../geo/geoUtils'

/** 現在のGPS座標から指定距離(m)以内に "Runの中心" があるRunの数。 */
export function nearbyRunCount(
  gps: [number, number],
  runs: Run[],
  thresholdM: number,
): number {
  const [gpsLng, gpsLat] = gps
  let count = 0
  for (const run of runs) {
    const center = computeRunCenter(run)
    if (!center) continue
    const d = haversineDistance(
      { lat: gpsLat, lng: gpsLng, altitude: null, timestamp: 0 },
      { lat: center[1], lng: center[0], altitude: null, timestamp: 0 },
    )
    if (d <= thresholdM) count++
  }
  return count
}

function computeRunCenter(run: Run): [number, number] | null {
  const pts = acceptedPoints(run.trackPoints)
  if (pts.length === 0) return null
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const p of pts) {
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
  }
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
}
