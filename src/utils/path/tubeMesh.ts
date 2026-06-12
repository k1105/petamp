import type { TrackPoint } from '../../types'
import { getFilteredAltitudeMap } from '../geo/altitudeFilters'
import { simplifyDouglasPeucker } from '../geo/simplify'

/** 線の Douglas-Peucker 単純化の許容誤差 (m)。視覚的に違いの出ない範囲で頂点を削減する。 */
const DEFAULT_SIMPLIFY_TOLERANCE_M = 0.5

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
