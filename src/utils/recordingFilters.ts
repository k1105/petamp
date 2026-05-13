import type { TrackPoint } from '../types'
import { haversineDistance } from './geoUtils'

export interface FilterContext {
  history: TrackPoint[]
  recordingStartedAt: number
}

export type PointFilter = (candidate: TrackPoint, ctx: FilterContext) => boolean

export function accuracyGate(maxMeters: number): PointFilter {
  return (p) => p.accuracy != null && p.accuracy <= maxMeters
}

export function warmupGate(warmupMs: number): PointFilter {
  return (p, ctx) => p.timestamp - ctx.recordingStartedAt >= warmupMs
}

export function minDistanceGate(minMeters: number): PointFilter {
  return (p, ctx) => {
    const last = ctx.history.at(-1)
    if (!last) return true
    return haversineDistance(last, p) >= minMeters
  }
}

export function maxSpeedGate(maxMetersPerSecond: number): PointFilter {
  return (p, ctx) => {
    const last = ctx.history.at(-1)
    if (!last) return true
    const dtSec = (p.timestamp - last.timestamp) / 1000
    if (dtSec <= 0) return false
    return haversineDistance(last, p) / dtSec <= maxMetersPerSecond
  }
}

export function defaultFilters(): PointFilter[] {
  return [
    accuracyGate(9),
    warmupGate(3000),
    minDistanceGate(5),
    maxSpeedGate(15),
  ]
}

export function applyFilters(
  candidate: TrackPoint,
  ctx: FilterContext,
  filters: PointFilter[],
): boolean {
  return filters.every(f => f(candidate, ctx))
}

export function acceptedPoints(points: TrackPoint[]): TrackPoint[] {
  return points.filter(p => !p.rejected)
}
