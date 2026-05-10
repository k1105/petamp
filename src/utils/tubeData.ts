import type { TrackPoint } from '../types'
import { haversineDistance } from './geoUtils'

export interface TubeSegment {
  position: [number, number, number]
  length: number  // 区間の長さ (m) — 半径は layer 側で動的に当てる
  orientation: [number, number, number]  // [pitch, yaw, roll]
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => d * Math.PI / 180
  const dLng = toRad(lng2 - lng1)
  const y = Math.sin(dLng) * Math.cos(toRad(lat2))
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
    - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng)
  return Math.atan2(y, x) * 180 / Math.PI
}

export interface TubeJoint {
  position: [number, number, number]
}

export function buildTubeJoints(points: TrackPoint[]): TubeJoint[] {
  return points.map(p => ({
    position: [p.lng, p.lat, 0] as [number, number, number],
  }))
}

export function buildTubeSegments(points: TrackPoint[]): TubeSegment[] {
  const segments: TubeSegment[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    const length = haversineDistance(a, b)
    if (length < 0.5) continue

    segments.push({
      position: [
        (a.lng + b.lng) / 2,
        (a.lat + b.lat) / 2,
        0,
      ],
      length,
      // yaw = -bearing: CylinderGeometry axis is Y (North), rotate CW to match bearing
      orientation: [0, -bearingDeg(a.lat, a.lng, b.lat, b.lng), 0],
    })
  }
  return segments
}
