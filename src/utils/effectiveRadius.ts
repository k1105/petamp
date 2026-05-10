/**
 * 軌跡描画の実効半径計算。zoomThreshold を 1 点アンカーに連続展開する。
 *
 * - zoom >= zoomThreshold: baseM をそのまま実半径(m)として使う (スケール依存)
 * - zoom <  zoomThreshold: baseM * 2^(zoomThreshold - zoom) (画面ピクセル一定)
 *
 * 閾値で連続。閾値以下では画面上のピクセル幅が固定（= zoom=zoomThreshold で
 * baseM[m] が画面に占める幅と等価）。
 *
 * unified mesh (tubeMesh.ts) は半径をメッシュに焼き込むため zoom 連続変化中は
 * メッシュ rebuild が走る。離散化(0.05m)で同一バケットを使い回しキャッシュヒット
 * を稼ぐ。
 */
export function effectiveRadius(
  zoom: number,
  zoomThreshold: number,
  baseM: number,
): number {
  if (zoom >= zoomThreshold) return baseM
  return baseM * Math.pow(2, zoomThreshold - zoom)
}

const BUCKET = 0.05

export function bucketRadius(r: number): number {
  return Math.round(r / BUCKET) * BUCKET
}
