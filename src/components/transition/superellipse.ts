/**
 * super-ellipse (スクワークル) の輪郭を SVG パス文字列で返す共有ヘルパー。
 * IrisFrame の緑フレームと PostRunLoadingScreen のマスクで共用する。
 *
 * 指数 n: 2 = 正円、大きいほど長方形に近づく (全辺はゆるく湾曲)。
 * clockwise=false で巻き方向を反転 → nonzero 塗りで「穴」(ドーナツ) を作れる。
 */
export function superellipseOutline(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  n: number,
  segments = 96,
  clockwise = true,
): string {
  if (rx <= 0.5 || ry <= 0.5) return ''
  const e = 2 / n
  let d = ''
  for (let i = 0; i < segments; i++) {
    const idx = clockwise ? i : segments - i
    const t = (idx / segments) * Math.PI * 2
    const ct = Math.cos(t)
    const st = Math.sin(t)
    const x = cx + Math.sign(ct) * Math.pow(Math.abs(ct), e) * rx
    const y = cy + Math.sign(st) * Math.pow(Math.abs(st), e) * ry
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `
  }
  return `${d}Z`
}
