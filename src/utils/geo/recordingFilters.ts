import type { TrackPoint } from '../../types'
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

/**
 * 既定のフィルタ閾値。petamp 本体での記録判定だけでなく、visualizer 等の外部ツールが
 * 同じ閾値で振る舞いを揃えられるよう export する。
 */
export const RECORDING_FILTER_DEFAULTS = {
  /** accuracy がこれ以下なら採用 (m)。 */
  maxAccuracyM: 15,
  /** 記録開始から warmup の点は捨てる (ms)。 */
  warmupMs: 3000,
  /** 直前点から最低この距離だけ動いていないと採用しない (m)。 */
  minDistanceM: 5,
  /** 直前点との見かけ速度がこれを超えたら異常扱い (m/s)。 */
  maxSpeedMps: 15,
} as const

export function defaultFilters(): PointFilter[] {
  return [
    accuracyGate(RECORDING_FILTER_DEFAULTS.maxAccuracyM),
    warmupGate(RECORDING_FILTER_DEFAULTS.warmupMs),
    minDistanceGate(RECORDING_FILTER_DEFAULTS.minDistanceM),
    maxSpeedGate(RECORDING_FILTER_DEFAULTS.maxSpeedMps),
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
