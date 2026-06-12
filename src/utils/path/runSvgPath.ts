import type { TrackPoint } from '../../types'
import { acceptedPoints } from '../geo/recordingFilters'

const VIEW_SIZE = 100
const PADDING = 6

export function buildRunSvgPath(points: TrackPoint[]): string {
  const accepted = acceptedPoints(points)
  if (accepted.length < 2) return ''

  const lats = accepted.map(p => p.lat)
  const lngs = accepted.map(p => p.lng)
  const latMin = Math.min(...lats)
  const latMax = Math.max(...lats)
  const lngMin = Math.min(...lngs)
  const lngMax = Math.max(...lngs)

  const refLat = (latMin + latMax) / 2
  const meterPerDeg = 111000
  const xPerLng = meterPerDeg * Math.cos(refLat * Math.PI / 180)
  const yPerLat = meterPerDeg

  const widthM = (lngMax - lngMin) * xPerLng
  const heightM = (latMax - latMin) * yPerLat
  const scaleM = Math.max(widthM, heightM, 1)

  const usable = VIEW_SIZE - PADDING * 2
  const xOffsetM = (scaleM - widthM) / 2
  const yOffsetM = (scaleM - heightM) / 2

  return accepted.map((p, i) => {
    const xM = (p.lng - lngMin) * xPerLng + xOffsetM
    const yM = (p.lat - latMin) * yPerLat + yOffsetM
    const x = PADDING + (xM / scaleM) * usable
    // 北を上にするためy反転
    const y = PADDING + ((scaleM - yM) / scaleM) * usable
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')
}

/**
 * 複数ランを「同じ座標系」で正規化し、揃った軌跡パスの配列を返す。
 * 各ランを個別に buildRunSvgPath すると bbox がバラバラで重ねても揃わないので、
 * 全ランの accepted 点をまとめた共通 bbox に投影する (一緒に走った軌跡の重ね描き用)。
 */
export function buildSharedRunSvgPaths(runsPoints: TrackPoint[][]): string[] {
  const accepted = runsPoints.map(pts => acceptedPoints(pts))
  const all = accepted.flat()
  if (all.length < 2) return runsPoints.map(() => '')

  const lats = all.map(p => p.lat)
  const lngs = all.map(p => p.lng)
  const latMin = Math.min(...lats)
  const latMax = Math.max(...lats)
  const lngMin = Math.min(...lngs)
  const lngMax = Math.max(...lngs)

  const refLat = (latMin + latMax) / 2
  const meterPerDeg = 111000
  const xPerLng = meterPerDeg * Math.cos((refLat * Math.PI) / 180)
  const yPerLat = meterPerDeg

  const widthM = (lngMax - lngMin) * xPerLng
  const heightM = (latMax - latMin) * yPerLat
  const scaleM = Math.max(widthM, heightM, 1)

  const usable = VIEW_SIZE - PADDING * 2
  const xOffsetM = (scaleM - widthM) / 2
  const yOffsetM = (scaleM - heightM) / 2

  return accepted.map(pts => {
    if (pts.length < 2) return ''
    return pts
      .map((p, i) => {
        const xM = (p.lng - lngMin) * xPerLng + xOffsetM
        const yM = (p.lat - latMin) * yPerLat + yOffsetM
        const x = PADDING + (xM / scaleM) * usable
        // 北を上にするため y 反転
        const y = PADDING + ((scaleM - yM) / scaleM) * usable
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
      })
      .join(' ')
  })
}

export const RUN_SVG_VIEW_SIZE = VIEW_SIZE
