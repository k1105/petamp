import type { Run } from '../types'
import { acceptedPoints } from './recordingFilters'

/** [[swLng, swLat], [neLng, neLat]] — Mapbox の LngLatBoundsLike と互換 */
export type LngLatBbox = [[number, number], [number, number]]

const METERS_PER_LAT_DEG = 110540

/** 全 run の accepted points を走査して合併bboxを返す。pointsゼロなら null。 */
export function computeRunsBbox(runs: Run[]): LngLatBbox | null {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  let any = false
  for (const run of runs) {
    const pts = acceptedPoints(run.trackPoints)
    for (const p of pts) {
      if (p.lng < minLng) minLng = p.lng
      if (p.lng > maxLng) maxLng = p.lng
      if (p.lat < minLat) minLat = p.lat
      if (p.lat > maxLat) maxLat = p.lat
      any = true
    }
  }
  if (!any) return null
  return [[minLng, minLat], [maxLng, maxLat]]
}

/** bbox の四方をメートル単位で膨張させる。緯度に応じて経度方向の換算を補正。 */
export function expandBboxByMeters(bbox: LngLatBbox, marginMeters: number): LngLatBbox {
  const meanLat = (bbox[0][1] + bbox[1][1]) / 2
  const metersPerLngDeg = 111320 * Math.cos((meanLat * Math.PI) / 180)
  const dLng = marginMeters / metersPerLngDeg
  const dLat = marginMeters / METERS_PER_LAT_DEG
  return [
    [bbox[0][0] - dLng, bbox[0][1] - dLat],
    [bbox[1][0] + dLng, bbox[1][1] + dLat],
  ]
}
