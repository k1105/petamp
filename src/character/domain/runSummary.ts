/**
 * Runから決定的に派生する特徴量。LLMに渡す「事実の側」。
 * ここを純粋関数で計算しておくことで、LLM出力の品質を切り分けて評価できる。
 */
export interface RunSummary {
  runId: string
  areaName?: string
  startedAt: number
  durationSec: number
  distanceM: number
  elevationGainM: number
  elevationLossM: number
  avgPaceSecPerKm: number | null
  /** "morning" | "noon" | "evening" | "night" 等、時間帯ラベル。 */
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
}
