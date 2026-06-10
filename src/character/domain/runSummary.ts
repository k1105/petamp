/**
 * Runから決定的に派生する特徴量。LLMに渡す「事実の側」。
 * ここを純粋関数で計算しておくことで、LLM出力の品質を切り分けて評価できる。
 */

import type { BehaviorState } from '../../utils/runBehavior'

export interface RunSegment {
  /** 0-based の連番。振る舞いベースで切られるため可変個数。 */
  index: number
  /** 区間全体の振る舞いラベル。 */
  behavior: BehaviorState
  /** 累積距離(m)。区間の始端と終端。 */
  startDistanceM: number
  endDistanceM: number
  distanceM: number
  /** Run開始からの秒数。 */
  startTimeSec: number
  endTimeSec: number
  durationSec: number
  avgPaceSecPerKm: number | null
  elevationGainM: number
  elevationLossM: number
  /** acceptedPoints 配列に対するインデックス。可視化で点列をスライスするのに使う。 */
  startPointIdx: number
  endPointIdx: number
}

type RunEventKind =
  | 'climb_burst'      // value = 上昇 m
  | 'descent_burst'    // value = 下降 m
  | 'u_turn'           // value = 方向変化角(deg)
  | 'revisit'          // value = 過去通過点との距離 m
  | 'pace_anomaly_slow'// value = avg比 (>1)
  | 'pace_anomaly_fast'// value = avg比 (<1)

export interface RunEvent {
  kind: RunEventKind
  /** 0-1 進行度 (距離ベース)。 */
  progress: number
  /** どのセグメントに含まれるか。 */
  segmentIndex: number
  /** kindごとに自然な単位の値。 */
  value: number
  /** prompt表示用の短い記述。 */
  description: string
}

export type RunTopologyShape =
  | 'loop'
  | 'out_and_back'
  | 'one_way'
  | 'figure_eight'
  | 'lollipop'
  | 'complex'

export interface RunTopology {
  shape: RunTopologyShape
  /** 始点と終点の距離 m。loop判定の主指標。 */
  startEndDistanceM: number
  /** 自己交差回数 (図形的)。 */
  selfIntersections: number
  /** 平面グラフで囲まれた領域数 (オイラー特性から導出)。0=開いた一本道、1=単純ループ or lollipop、2=8の字、≥3=複雑。 */
  enclosedRegions: number
  /** bbox の幅/高さ比 (m単位)。1超は横長、1未満は縦長。 */
  bboxAspectRatio: number
  /** 全距離 / bbox 対角線 m。1.0付近=直線的、大きいほど蛇行。 */
  squiggliness: number
}

export interface PaceDistribution {
  fastFraction: number
  normalFraction: number
  slowFraction: number
  /** 閾値の基準となるペース (sec/km)。 */
  referencePaceSecPerKm: number | null
}

export interface RunSummary {
  runId: string
  areaName?: string
  startedAt: number
  durationSec: number
  distanceM: number
  elevationGainM: number
  elevationLossM: number
  avgPaceSecPerKm: number | null
  /** "morning" | "noon" | "afternoon" | "evening" | "night" 等。 */
  timeOfDay: string
  /** 一定以上止まっていた区間の数。 */
  stopCount: number
  noteCount: number
  /** 同エリアの過去Run統計との比較。初回ならundefined。 */
  vsAreaAverage?: {
    distanceRatio: number
    paceRatio: number
    elevationRatio: number
  }
  /** 振る舞いベースで切られたセグメント (resting/walking/running)。 */
  segments: RunSegment[]
  /** 特徴的な瞬間。最大~8件にキャップ。 */
  events: RunEvent[]
  topology: RunTopology
  paceDistribution: PaceDistribution
}
