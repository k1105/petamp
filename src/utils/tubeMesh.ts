import type { TrackPoint } from '../types'

/** barometric を優先、無ければ GPS altitude。両方 null なら null。 */
export function rawAltitude(p: TrackPoint): number | null {
  if (p.barometricAltitude != null) return p.barometricAltitude
  if (p.altitude != null) return p.altitude
  return null
}

/**
 * 各点の相対高度 (m, 全点中の最低値を 0 基準) を返す。null は直前値を継続、
 * 先頭で値が無い間は 0。下りランでも全 z が 0 以上になり、near plane で潜らない。
 * スムージングや欠損補間はしない (visualizer 側で後追い)。
 */
export function relativeAltitudes(points: TrackPoint[]): Float32Array {
  const N = points.length
  const out = new Float32Array(N)
  let baseline = Infinity
  for (const p of points) {
    const v = rawAltitude(p)
    if (v != null && v < baseline) baseline = v
  }
  if (!Number.isFinite(baseline)) return out  // 全点 null
  let last = 0
  for (let i = 0; i < N; i++) {
    const v = rawAltitude(points[i])
    if (v != null) last = v - baseline
    out[i] = last
  }
  return out
}

/**
 * PathLayer 用に [lng, lat, z] の配列を組む。altitudeScale=0 で平面、>0 で
 * relativeAltitudes() を z 軸に反映。
 */
export function buildPathPositions(
  points: TrackPoint[],
  altitudeScale: number = 0,
): [number, number, number][] {
  if (altitudeScale <= 0) {
    return points.map(p => [p.lng, p.lat, 0])
  }
  const rel = relativeAltitudes(points)
  return points.map((p, i) => [p.lng, p.lat, rel[i] * altitudeScale])
}
