import type { TrackPoint } from '../types'
import { getFilteredAltitudeMap } from './altitudeFilters'
import { simplifyDouglasPeucker } from './simplify'

/** 線の Douglas-Peucker 単純化の許容誤差 (m)。視覚的に違いの出ない範囲で頂点を削減する。 */
const DEFAULT_SIMPLIFY_TOLERANCE_M = 0.5

/** barometric を優先、無ければ GPS altitude。両方 null なら null。生値 (フィルタ未適用)。 */
export function rawAltitude(p: TrackPoint): number | null {
  if (p.barometricAltitude != null) return p.barometricAltitude
  if (p.altitude != null) return p.altitude
  return null
}

/**
 * 各点の相対高度 (m, 全点中の最低値を 0 基準) を返す。下りランでも全 z が 0 以上に
 * なり、near plane で潜らない。
 *
 * 高度値はノイズ除去・平滑化パイプライン (altitudeFilters) を通したあとの値を使う。
 * パイプラインで両端まで有効値が無かった点は直前値を継続、先頭で値が無い間は 0。
 */
export function relativeAltitudes(points: TrackPoint[]): Float32Array {
  const N = points.length
  const out = new Float32Array(N)
  const altMap = getFilteredAltitudeMap(points)
  let baseline = Infinity
  for (const p of points) {
    const v = altMap.get(p)
    if (v != null && v < baseline) baseline = v
  }
  if (!Number.isFinite(baseline)) return out  // 全点 null
  let last = 0
  for (let i = 0; i < N; i++) {
    const v = altMap.get(points[i])
    if (v != null) last = v - baseline
    out[i] = last
  }
  return out
}

/**
 * PathLayer 用に [lng, lat, z] の配列を組む。altitudeScale=0 で平面、>0 で
 * 相対高度を z 軸に反映。
 *
 * 描画頂点は Douglas-Peucker で simplifyToleranceM (デフォルト 0.5m) まで間引く。
 * 高度フィルタは間引き前の全点で計算するため、動点側 (relAltitudeAtTime) と
 * 同じ altitude map を共有して Z が一致する。間引きを無効化したい場合は
 * simplifyToleranceM=0 を渡す。
 */
export function buildPathPositions(
  points: TrackPoint[],
  altitudeScale: number = 0,
  simplifyToleranceM: number = DEFAULT_SIMPLIFY_TOLERANCE_M,
): [number, number, number][] {
  const drawPoints = simplifyToleranceM > 0
    ? simplifyDouglasPeucker(points, simplifyToleranceM)
    : points
  if (altitudeScale <= 0) {
    return drawPoints.map(p => [p.lng, p.lat, 0])
  }
  // 高度は元の全点で算出。simplify 後の頂点は元の TrackPoint 参照を保つので
  // 同じ map から引ける。
  const altMap = getFilteredAltitudeMap(points)
  let baseline = Infinity
  for (const p of points) {
    const v = altMap.get(p)
    if (v != null && v < baseline) baseline = v
  }
  if (!Number.isFinite(baseline)) {
    return drawPoints.map(p => [p.lng, p.lat, 0])
  }
  let last = 0
  return drawPoints.map(p => {
    const v = altMap.get(p)
    if (v != null) last = v - baseline
    return [p.lng, p.lat, last * altitudeScale]
  })
}
