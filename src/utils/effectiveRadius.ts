/**
 * 軌跡描画の実効半径計算。zoomThreshold を 1 点アンカーに連続展開する。
 *
 * - zoom >= zoomThreshold: baseM をそのまま実半径(m)として使う (スケール依存、
 *   寄ると画面上で太くなる)
 * - zoom <  zoomThreshold: baseM * 2^(zoomThreshold - zoom) (画面ピクセル一定)
 *
 * 閾値で連続。閾値未満では画面上のピクセル幅が固定 (= zoom=zoomThreshold で
 * baseM[m] が画面に占める幅と等価)。PathLayer の getWidth (widthUnits='meters')
 * や ScatterplotLayer の getRadius にそのまま流す。
 */
export function effectiveRadius(
  zoom: number,
  zoomThreshold: number,
  baseM: number,
): number {
  if (zoom >= zoomThreshold) return baseM
  return baseM * Math.pow(2, zoomThreshold - zoom)
}
