import type { TrackPoint } from '../../types'

/**
 * 高度ノイズ除去・平滑化パイプライン。
 *
 * 各段は純粋関数として export してあり、petamp 本体と petamp-visualizer の双方で
 * 個別に呼び出して同じ結果を得られる。petamp 本体は getFilteredAltitudeMap() で
 * デフォルトパラメータの一括適用を使い、visualizer は段ごとに UI パラメータを
 * 差し替えて検証する。
 *
 * パイプライン:
 *   1) 垂直精度ゲート: altitudeAccuracy > accuracyMaxM → null マーク
 *   2) 垂直速度ゲート: |dz/dt| > verticalSpeedMaxMps → null マーク
 *   3) メディアン (kernel): スパイク除去 (エッジ保存)
 *   4) 移動平均 (window): 高周波ノイズの平滑化
 *   5) 線形補間: null になった点を前後の有効値から時刻基準で内挿
 */

export interface AltitudeFilterParams {
  accuracyMaxM: number
  verticalSpeedMaxMps: number
  medianKernel: number
  movingAvgWindow: number
}

export const DEFAULT_ALTITUDE_FILTER_PARAMS: AltitudeFilterParams = {
  accuracyMaxM: 5,
  verticalSpeedMaxMps: 3,
  medianKernel: 21,
  movingAvgWindow: 22,
}

/** barometric > GPS。tubeMesh.rawAltitude と同規約だが循環インポート回避のため独立保持。 */
export function rawAltitudeOf(p: TrackPoint): number | null {
  if (p.barometricAltitude != null) return p.barometricAltitude
  if (p.altitude != null) return p.altitude
  return null
}

function altAccuracyGate(
  samples: (number | null)[],
  points: TrackPoint[],
  maxAccuracyM: number,
): (number | null)[] {
  return samples.map((alt, i) => {
    const acc = points[i].altitudeAccuracy
    return acc != null && acc > maxAccuracyM ? null : alt
  })
}

function altVerticalSpeedGate(
  samples: (number | null)[],
  points: TrackPoint[],
  maxVerticalSpeedMps: number,
): (number | null)[] {
  const out: (number | null)[] = new Array(samples.length)
  let lastValidIdx = -1
  for (let i = 0; i < samples.length; i++) {
    const cur = samples[i]
    if (cur == null) {
      out[i] = null
      continue
    }
    if (lastValidIdx < 0) {
      out[i] = cur
      lastValidIdx = i
      continue
    }
    const dt = (points[i].timestamp - points[lastValidIdx].timestamp) / 1000
    if (dt <= 0) {
      out[i] = cur
      lastValidIdx = i
      continue
    }
    const vs = Math.abs(cur - (out[lastValidIdx] as number)) / dt
    if (vs <= maxVerticalSpeedMps) {
      out[i] = cur
      lastValidIdx = i
    } else {
      out[i] = null
      // 棄却サンプルでは lastValidIdx を更新しない
    }
  }
  return out
}

function altMedianFilter(samples: (number | null)[], kernel: number): (number | null)[] {
  const k = Math.max(1, Math.floor(kernel) | 1)
  const half = (k - 1) / 2
  return samples.map((_, i) => {
    const start = Math.max(0, i - half)
    const end = Math.min(samples.length, i + half + 1)
    const win: number[] = []
    for (let j = start; j < end; j++) {
      const a = samples[j]
      if (a != null) win.push(a)
    }
    if (win.length === 0) return null
    win.sort((a, b) => a - b)
    return win[Math.floor(win.length / 2)]
  })
}

function altMovingAverage(samples: (number | null)[], window: number): (number | null)[] {
  const w = Math.max(1, Math.floor(window))
  const half = Math.floor(w / 2)
  return samples.map((_, i) => {
    const start = Math.max(0, i - half)
    const end = Math.min(samples.length, i + half + 1)
    let sum = 0
    let count = 0
    for (let j = start; j < end; j++) {
      const a = samples[j]
      if (a != null) {
        sum += a
        count++
      }
    }
    if (count === 0) return null
    return sum / count
  })
}

function altInterpolateNulls(
  samples: (number | null)[],
  points: TrackPoint[],
): (number | null)[] {
  const out = samples.slice()
  for (let i = 0; i < out.length; i++) {
    if (out[i] != null) continue
    let prev = i - 1
    while (prev >= 0 && samples[prev] == null) prev--
    let next = i + 1
    while (next < out.length && samples[next] == null) next++
    const a = prev >= 0 ? samples[prev] : null
    const b = next < out.length ? samples[next] : null
    if (a != null && b != null) {
      const t0 = points[prev].timestamp
      const t1 = points[next].timestamp
      const dt = t1 - t0
      const u = dt > 0 ? (points[i].timestamp - t0) / dt : 0.5
      out[i] = a + (b - a) * u
    } else if (a != null) {
      out[i] = a
    } else if (b != null) {
      out[i] = b
    }
  }
  return out
}

/**
 * パイプライン全段を一括適用して (number | null)[] を返す。getFilteredAltitudeMap の中身。
 */
export function applyAltitudePipeline(
  points: TrackPoint[],
  params: AltitudeFilterParams = DEFAULT_ALTITUDE_FILTER_PARAMS,
): (number | null)[] {
  const init = points.map(rawAltitudeOf)
  let cur = altAccuracyGate(init, points, params.accuracyMaxM)
  cur = altVerticalSpeedGate(cur, points, params.verticalSpeedMaxMps)
  cur = altMedianFilter(cur, params.medianKernel)
  cur = altMovingAverage(cur, params.movingAvgWindow)
  cur = altInterpolateNulls(cur, points)
  return cur
}

// 1 run / 1 path につき1回計算すれば足りるので、入力配列の参照同一性でキャッシュする。
// params 指定時はキャッシュしない (毎回パラメータが変わる可能性があるため)。
const defaultParamsCache = new WeakMap<TrackPoint[], Map<TrackPoint, number>>()

/**
 * 全フィルタ + 線形補間を通したあとの「TrackPoint → 高度 (m, 海抜 or 気圧計基準)」マップ。
 * params を渡さない場合は DEFAULT_ALTITUDE_FILTER_PARAMS が使われ、入力配列の参照が
 * 同じ間はキャッシュを返す。両端まで有効値が無かった場合はマップに含まれない。
 */
export function getFilteredAltitudeMap(
  points: TrackPoint[],
  params?: AltitudeFilterParams,
): Map<TrackPoint, number> {
  if (params === undefined) {
    const hit = defaultParamsCache.get(points)
    if (hit) return hit
  }
  const cur = applyAltitudePipeline(points, params)
  const map = new Map<TrackPoint, number>()
  for (let i = 0; i < points.length; i++) {
    const v = cur[i]
    if (v != null) map.set(points[i], v)
  }
  if (params === undefined) defaultParamsCache.set(points, map)
  return map
}
