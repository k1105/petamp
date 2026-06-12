export interface Point2D {
  x: number
  y: number
}

/**
 * Catmull-Rom スプライン (uniform) を 3 次ベジェに変換した SVG path d 文字列を返す。
 * - closed=true で末尾と先頭を連結したループになる。
 * - tension は 0〜1。1 で標準の Catmull-Rom、0 で直線。
 */
export function catmullRomPath(
  points: Point2D[],
  opts: { closed?: boolean; tension?: number } = {},
): string {
  const { closed = false, tension = 1 } = opts
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`

  const n = points.length
  const get = (i: number): Point2D => {
    if (closed) return points[((i % n) + n) % n]
    return points[Math.max(0, Math.min(n - 1, i))]
  }

  const k = tension / 6
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  const limit = closed ? n : n - 1
  for (let i = 0; i < limit; i++) {
    const p0 = get(i - 1)
    const p1 = get(i)
    const p2 = get(i + 1)
    const p3 = get(i + 2)
    const c1x = p1.x + (p2.x - p0.x) * k
    const c1y = p1.y + (p2.y - p0.y) * k
    const c2x = p2.x - (p3.x - p1.x) * k
    const c2y = p2.y - (p3.y - p1.y) * k
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  if (closed) d += ' Z'
  return d
}
