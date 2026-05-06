import type { TrackPoint } from '../types'

export function buildPathLayerData(points: TrackPoint[]): [number, number, number][][] {
  if (points.length < 2) return []
  const path = points.map(p => [p.lng, p.lat, 0] as [number, number, number])
  return [path]
}
