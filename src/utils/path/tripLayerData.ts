import type { Run } from '../../types'

export interface TripDatum {
  path: [number, number, number][]
  timestamps: number[]
}

export function buildTripLayerData(run: Run): { data: TripDatum[]; duration: number } {
  const origin = run.startedAt
  const points = run.trackPoints

  const path = points.map(p => [p.lng, p.lat, p.altitude ?? 0] as [number, number, number])
  const timestamps = points.map(p => (p.timestamp - origin) / 1000)

  return {
    data: [{ path, timestamps }],
    duration: (run.finishedAt - run.startedAt) / 1000,
  }
}
