import type { TrackPoint } from '../types'
import {
  applyAltitudePipeline,
  DEFAULT_ALTITUDE_FILTER_PARAMS,
  type AltitudeFilterParams,
} from './altitudeFilters'
import { haversineDistance } from './geoUtils'

/**
 * 「解釈用」の中間表現。記録された生 TrackPoint に対し、
 *   - 高度フィルタを通した altitudeFiltered
 *   - 平滑化された speed (m/s)
 *   - 移動種別 motionType (resting / walking / running)
 * を付与する。記録/保存と描画/解釈を分離するための層。
 *
 * `raw` で元の TrackPoint を保持するので、デバッグや再計算は元データから可能。
 */

export type MotionType = 'resting' | 'walking' | 'running'

export interface EnrichedPoint {
  raw: TrackPoint
  altitudeFiltered: number | null
  speed: number
  motionType: MotionType
}

export interface MotionTypeParams {
  /** 平滑化後の speed がこれ未満なら resting 候補 (m/s)。 */
  restingSpeed: number
  /** 平滑化後の speed がこれ以上なら running 候補 (m/s)。 */
  runningSpeed: number
  /** speed 移動平均ウィンドウ (点数)。 */
  smoothingWindow: number
  /** ヒステリシス: 新状態がこの秒数連続したら確定。 */
  dwellSec: number
  /** ±restWindowSec 秒以内の最大距離がこれ未満なら resting に上書き (m)。 */
  restSpreadM: number
  /** resting 補強のための時間窓 (秒)。 */
  restWindowSec: number
}

export const DEFAULT_MOTION_TYPE_PARAMS: MotionTypeParams = {
  restingSpeed: 0.5,
  runningSpeed: 2.2,
  smoothingWindow: 5,
  dwellSec: 5,
  restSpreadM: 5,
  restWindowSec: 5,
}

export interface EnrichOptions {
  altitude?: AltitudeFilterParams
  motion?: MotionTypeParams
}

function movingAverage(values: number[], window: number): number[] {
  if (window <= 1 || values.length === 0) return values.slice()
  const half = Math.floor(window / 2)
  const out: number[] = new Array(values.length)
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - half)
    const hi = Math.min(values.length - 1, i + half)
    let s = 0
    for (let j = lo; j <= hi; j++) s += values[j]
    out[i] = s / (hi - lo + 1)
  }
  return out
}

function classifyMotion(
  points: TrackPoint[],
  speed: number[],
  params: MotionTypeParams,
): MotionType[] {
  const n = points.length
  if (n === 0) return []

  // resting 補強用の位置散らばり (±restWindowSec 秒)。
  const halfMs = params.restWindowSec * 1000
  const spread: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    let lo = i
    let hi = i
    while (lo > 0 && points[i].timestamp - points[lo - 1].timestamp <= halfMs) lo--
    while (hi < n - 1 && points[hi + 1].timestamp - points[i].timestamp <= halfMs) hi++
    let maxD = 0
    for (let j = lo; j <= hi; j++) {
      const d = haversineDistance(points[i], points[j])
      if (d > maxD) maxD = d
    }
    spread[i] = maxD
  }

  // 各点の raw ラベル。
  const raw: MotionType[] = new Array(n)
  for (let i = 0; i < n; i++) {
    if (speed[i] < params.restingSpeed || spread[i] < params.restSpreadM) {
      raw[i] = 'resting'
    } else if (speed[i] < params.runningSpeed) {
      raw[i] = 'walking'
    } else {
      raw[i] = 'running'
    }
  }

  // ヒステリシス: 新ラベルが dwellSec 以上連続したら確定 + さかのぼり置換。
  const labels: MotionType[] = new Array(n)
  labels[0] = raw[0]
  let pending: { state: MotionType; startIdx: number } | null = null
  for (let i = 1; i < n; i++) {
    const cur = labels[i - 1]
    if (raw[i] === cur) {
      pending = null
      labels[i] = cur
      continue
    }
    if (!pending || pending.state !== raw[i]) {
      pending = { state: raw[i], startIdx: i }
    }
    const elapsed = (points[i].timestamp - points[pending.startIdx].timestamp) / 1000
    if (elapsed >= params.dwellSec) {
      for (let j = pending.startIdx; j <= i; j++) labels[j] = pending.state
      pending = null
    } else {
      labels[i] = cur
    }
  }
  return labels
}

/**
 * TrackPoint[] を EnrichedPoint[] に変換する。入力は通常 acceptedPoints(rejected除外済み)
 * を想定。各派生属性は同じ入力配列に対して同じ結果を返す純粋計算。
 */
export function enrich(points: TrackPoint[], opts: EnrichOptions = {}): EnrichedPoint[] {
  const altParams = opts.altitude ?? DEFAULT_ALTITUDE_FILTER_PARAMS
  const motionParams = opts.motion ?? DEFAULT_MOTION_TYPE_PARAMS
  const n = points.length
  if (n === 0) return []

  const altitudes = applyAltitudePipeline(points, altParams)

  // 隣接点間の瞬間速度 (i は i-1 → i の区間速度を持つ)。
  const inst: number[] = new Array(n).fill(0)
  for (let i = 1; i < n; i++) {
    const dt = (points[i].timestamp - points[i - 1].timestamp) / 1000
    const d = haversineDistance(points[i - 1], points[i])
    inst[i] = dt > 0 ? d / dt : 0
  }
  inst[0] = inst[1] ?? 0

  const speed = movingAverage(inst, motionParams.smoothingWindow)
  const motion = classifyMotion(points, speed, motionParams)

  const out: EnrichedPoint[] = new Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = {
      raw: points[i],
      altitudeFiltered: altitudes[i],
      speed: speed[i],
      motionType: motion[i],
    }
  }
  return out
}
