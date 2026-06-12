import type { TrackPoint } from '../../types'

/**
 * Douglas-Peucker による軌跡の単純化 (LOD)。
 * tolerance はメートル単位で、点から区間 a-b への垂線距離の閾値。
 * lat/lng はローカル平面近似 (赤道半径 * cosLat) で m に変換して計算する。
 *
 * 大規模な軌跡描画 (例: 100h × 複数人) ではこの関数で頂点を間引いてから
 * PathLayer 等に渡すことで描画コストを抑えられる。出力は入力の TrackPoint
 * オブジェクトの部分集合 (参照は保つ) なので、altitudeFilters 等の WeakMap
 * キャッシュも引き続き効く。
 */
export function simplifyDouglasPeucker(points: TrackPoint[], toleranceM: number): TrackPoint[] {
  const n = points.length
  if (n < 3 || toleranceM <= 0) return points.slice()
  const lat0 = points[0].lat
  const cosLat = Math.cos((lat0 * Math.PI) / 180)
  const mPerDegLat = 110540
  const mPerDegLng = 111320 * cosLat
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    xs[i] = points[i].lng * mPerDegLng
    ys[i] = points[i].lat * mPerDegLat
  }
  const perpDist = (i: number, a: number, b: number) => {
    const dx = xs[b] - xs[a]
    const dy = ys[b] - ys[a]
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len === 0) {
      const ex = xs[i] - xs[a]
      const ey = ys[i] - ys[a]
      return Math.sqrt(ex * ex + ey * ey)
    }
    return Math.abs(dx * (ys[a] - ys[i]) - (xs[a] - xs[i]) * dy) / len
  }
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length > 0) {
    const [a, b] = stack.pop()!
    if (b - a < 2) continue
    let maxD = 0
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = perpDist(i, a, b)
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > toleranceM && idx !== -1) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  const out: TrackPoint[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i])
  return out
}
