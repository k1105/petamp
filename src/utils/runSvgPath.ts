import type { TrackPoint } from '../types'
import { acceptedPoints } from './recordingFilters'

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

export const RUN_SVG_VIEW_SIZE = VIEW_SIZE
