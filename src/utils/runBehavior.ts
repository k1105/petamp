import type { TrackPoint } from '../types'
import { haversineDistance } from './geoUtils'

/**
 * 振る舞いベースのセグメンテーションで使う点ごとの状態。
 * 距離6等分のセグメンテーションを置き換える、意味ベースの単位の基礎。
 */
export type BehaviorState = 'resting' | 'walking' | 'running'

export interface BehaviorParams {
  /** 平滑化速度がこれ未満なら resting 候補 (m/s)。 */
  restingSpeed: number
  /** 平滑化速度がこれ以上なら running 候補 (m/s)。 */
  runningSpeed: number
  /** 速度移動平均ウィンドウ (点数、1=平滑化なし)。 */
  smoothingWindow: number
  /** 新状態が連続してこの秒数以上続いたら確定 (ヒステリシス)。 */
  dwellSec: number
}

/**
 * petamp 本体で振る舞い分類に使う閾値の真実の源。
 * petamp-visualizer の motion-type viz は defaultParams としてこの値を import すること。
 * ここを書き換えると両側に同時に反映される。
 */
const DEFAULT_BEHAVIOR_PARAMS: BehaviorParams = {
  restingSpeed: 0.5,
  runningSpeed: 3.0,
  smoothingWindow: 5,
  dwellSec: 5,
}

/** resting 補強: ±REST_WINDOW_SEC 秒以内の点との最大距離がこれ未満なら resting に上書き。 */
const REST_SPREAD_METERS = 5
const REST_WINDOW_SEC = 5

/**
 * セグメント化の後処理パラメータ。短すぎる区間の吸収と上限カット用。
 * 点ごとの分類 (BehaviorParams) とは別軸。LLM プロンプトを読みやすく保つ用途。
 */
export interface BehaviorSegmentParams extends BehaviorParams {
  /** この秒数未満のセグメントは隣に吸収する。0 なら無効。 */
  minSegmentDurationSec: number
  /** セグメント上限。これを超えたら短いものから順に隣に併合する。0 なら無効。 */
  maxSegments: number
}

export const DEFAULT_BEHAVIOR_SEGMENT_PARAMS: BehaviorSegmentParams = {
  ...DEFAULT_BEHAVIOR_PARAMS,
  minSegmentDurationSec: 10,
  maxSegments: 10,
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

/**
 * 各 TrackPoint に対して 'resting' / 'walking' / 'running' のラベルを返す。
 * 手順は (1) 瞬間速度 → (2) 平滑化 → (3) resting の位置散らばり補強 → (4) raw 分類 → (5) dwellSec ヒステリシス。
 * 入力は accepted な点列を想定 (rejected フィルタは呼び元の責任)。
 */
export function classifyBehavior(
  points: TrackPoint[],
  params: BehaviorParams = DEFAULT_BEHAVIOR_PARAMS,
): BehaviorState[] {
  const n = points.length
  if (n === 0) return []
  if (n === 1) return ['resting']

  const inst: number[] = new Array(n).fill(0)
  for (let i = 1; i < n; i++) {
    const dt = (points[i].timestamp - points[i - 1].timestamp) / 1000
    const d = haversineDistance(points[i - 1], points[i])
    inst[i] = dt > 0 ? d / dt : 0
  }
  inst[0] = inst[1] ?? 0

  const speed = movingAverage(inst, params.smoothingWindow)

  const halfMs = REST_WINDOW_SEC * 1000
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

  const raw: BehaviorState[] = new Array(n)
  for (let i = 0; i < n; i++) {
    if (speed[i] < params.restingSpeed || spread[i] < REST_SPREAD_METERS) {
      raw[i] = 'resting'
    } else if (speed[i] < params.runningSpeed) {
      raw[i] = 'walking'
    } else {
      raw[i] = 'running'
    }
  }

  const labels: BehaviorState[] = new Array(n)
  labels[0] = raw[0]
  let pending: { state: BehaviorState; startIdx: number } | null = null
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
