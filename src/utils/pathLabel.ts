/**
 * 道路名のように、与えられた polyline に沿って 1 文字ずつ配置するテキスト ラベル
 * を生成するヘルパ。deck.gl の TextLayer に渡せる形 `{ position, text, angle }[]`
 * を返す。
 *
 * 設計:
 *  - 位置を Chaikin のコーナーカット (default 2 回) で滑らかにしてから歩く
 *  - 接線は局所セグメントではなく、文字位置の前後 chord 長 (= 文字幅の 2 倍程度)
 *    の弦 (chord) から取る。微小なジグザグを平均化
 *  - 1 ラベルにつき start / mid / end の 3 アンカー (slice が短ければ中央のみ)
 *  - アンカー中心の接線が逆向きなら全 char を 180° 反転して読み方向を保つ
 *
 * x, y は任意のメートル座標、alt は z 用 (zScale 倍して position に乗る)。
 */

export interface PathNode {
  x: number
  y: number
  alt: number
}

export interface PathChar {
  position: [number, number, number]
  text: string
  angle: number
}

/** Chaikin のコーナーカット 1 回。端点は保持。 */
function chaikinOnce(pl: PathNode[]): PathNode[] {
  if (pl.length < 3) return pl
  const out: PathNode[] = [pl[0]]
  for (let k = 0; k < pl.length - 1; k++) {
    const a = pl[k]
    const b = pl[k + 1]
    out.push(
      { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25, alt: a.alt * 0.75 + b.alt * 0.25 },
      { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75, alt: a.alt * 0.25 + b.alt * 0.75 },
    )
  }
  out.push(pl[pl.length - 1])
  return out
}

/** Chaikin を指定回数 (default 2) 適用。位置を滑らかにする。 */
export function smoothPath(pl: PathNode[], iterations = 2): PathNode[] {
  let out = pl
  for (let i = 0; i < iterations; i++) out = chaikinOnce(out)
  return out
}

/** 連続ノードの累積距離 (m)。長さ N。 */
export function cumulativeDist(slice: ReadonlyArray<PathNode>): number[] {
  const c = new Array<number>(slice.length)
  c[0] = 0
  for (let i = 1; i < slice.length; i++) {
    const dx = slice[i].x - slice[i - 1].x
    const dy = slice[i].y - slice[i - 1].y
    c[i] = c[i - 1] + Math.sqrt(dx * dx + dy * dy)
  }
  return c
}

interface PointAt extends PathNode { tx: number; ty: number }

function positionAt(
  slice: ReadonlyArray<PathNode>,
  cum: ReadonlyArray<number>,
  dist: number,
): PathNode {
  const total = cum[cum.length - 1]
  const d = Math.max(0, Math.min(total, dist))
  let k = 0
  for (; k < cum.length - 1; k++) if (cum[k + 1] >= d) break
  if (k >= cum.length - 1) k = cum.length - 2
  const segLen = Math.max(1e-6, cum[k + 1] - cum[k])
  const t = (d - cum[k]) / segLen
  return {
    x: slice[k].x + t * (slice[k + 1].x - slice[k].x),
    y: slice[k].y + t * (slice[k + 1].y - slice[k].y),
    alt: slice[k].alt + t * (slice[k + 1].alt - slice[k].alt),
  }
}

/**
 * dist 位置の (x,y,alt) と、その位置の chord ベース接線 (tx,ty) を返す。
 * 接線は dist ± chordSpan の 2 点を結ぶ弦から計算する。
 */
export function pointAt(
  slice: ReadonlyArray<PathNode>,
  cum: ReadonlyArray<number>,
  dist: number,
  chordSpan: number,
): PointAt {
  const p = positionAt(slice, cum, dist)
  const a = positionAt(slice, cum, dist - chordSpan)
  const b = positionAt(slice, cum, dist + chordSpan)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.max(1e-6, Math.sqrt(dx * dx + dy * dy))
  return { ...p, tx: dx / len, ty: dy / len }
}

export interface PlaceTextOptions {
  charWidthM: number
  tangentChordM: number
  zScale: number
  /** ラベル z オフセット (alt*zScale の上にどれだけ持ち上げるか)。default 0.5。 */
  zLift?: number
}

/**
 * slice (smoothPath 後を渡すのが推奨) の `anchorDist` 位置を中心に、`text` を
 * 1 文字ずつ並べる。各文字の角度は局所接線方向。アンカー位置の接線が逆向きなら
 * 全文字を反転して読み方向を保つ。
 */
export function placeTextAlongPath(
  slice: ReadonlyArray<PathNode>,
  cum: ReadonlyArray<number>,
  anchorDist: number,
  text: string,
  opts: PlaceTextOptions,
): PathChar[] {
  const { charWidthM, tangentChordM, zScale } = opts
  const zLift = opts.zLift ?? 0.5
  const center = pointAt(slice, cum, anchorDist, tangentChordM)
  const centerAngle = Math.atan2(center.ty, center.tx) * (180 / Math.PI)
  const flip = centerAngle > 90 || centerAngle < -90
  const out: PathChar[] = []
  for (let i = 0; i < text.length; i++) {
    const offset = (i - (text.length - 1) / 2) * charWidthM
    const charDist = flip ? anchorDist - offset : anchorDist + offset
    const p = pointAt(slice, cum, charDist, tangentChordM)
    let a = Math.atan2(p.ty, p.tx) * (180 / Math.PI)
    if (flip) a += 180
    while (a > 180) a -= 360
    while (a < -180) a += 360
    out.push({
      position: [p.x, p.y, Math.max(0, p.alt) * zScale + zLift],
      text: text[i],
      angle: a,
    })
  }
  return out
}

/**
 * polyline の総距離に応じて start/mid/end の 3 アンカー (短ければ中央のみ) を
 * 決定し、`placeTextAlongPath` を呼んでぜんぶの文字を集めて返す高レベル API。
 *
 * 短すぎる (text すら入らない) slice は空配列を返す。
 */
export function buildPathLabel(
  slice: ReadonlyArray<PathNode>,
  text: string,
  opts: PlaceTextOptions,
): PathChar[] {
  if (slice.length < 2 || text.length === 0) return []
  const cum = cumulativeDist(slice)
  const totalL = cum[cum.length - 1]
  const textTotalM = text.length * opts.charWidthM
  if (totalL < textTotalM * 0.6) return []
  const anchors: number[] =
    totalL >= textTotalM * 2.5
      ? [textTotalM * 0.6, totalL / 2, totalL - textTotalM * 0.6]
      : [totalL / 2]
  const out: PathChar[] = []
  for (const ad of anchors) out.push(...placeTextAlongPath(slice, cum, ad, text, opts))
  return out
}
