/**
 * 現在地から方位 (heading) 方向へ伸びる「レーダー扇形」を作る。
 * Google Map の現在地ビームのように、中心が濃く外側へグラデーションで薄れる。
 *
 * deck.gl の SolidPolygonLayer は 1 ポリゴン = 単色なので、半径方向に bands 個の
 * 同心扇帯へ分割し、外側の帯ほど alpha を落とすことでグラデーションを近似する。
 * ポリゴンは [lng, lat] (z=0, 地面) で返すので、傾いたカメラでも地面に沿って寝る。
 */
export interface ConeBand {
  /** [lng, lat] の頂点列 (閉じる必要なし)。 */
  polygon: [number, number][]
  /** 0..1 の不透明度係数 (中心が大きく外側で小さい)。 */
  alpha: number
}

export function buildHeadingCone(
  center: [number, number],
  headingDeg: number,
  lengthM: number,
  halfAngleDeg = 32,
  bands = 8,
  arcSteps = 16,
): ConeBand[] {
  const [lng, lat] = center
  const mPerLat = 111320
  const mPerLng = 111320 * Math.cos((lat * Math.PI) / 180)
  const toRad = (d: number) => (d * Math.PI) / 180

  // 距離 d(m)・方位 b(度, 0=北 時計回り) の地点を [lng, lat] で返す。
  const project = (d: number, bDeg: number): [number, number] => {
    const b = toRad(bDeg)
    const north = d * Math.cos(b)
    const east = d * Math.sin(b)
    return [lng + east / mPerLng, lat + north / mPerLat]
  }

  const a0 = headingDeg - halfAngleDeg
  const a1 = headingDeg + halfAngleDeg
  const angles: number[] = []
  for (let i = 0; i <= arcSteps; i++) {
    angles.push(a0 + ((a1 - a0) * i) / arcSteps)
  }

  const result: ConeBand[] = []
  for (let k = 0; k < bands; k++) {
    const rIn = (lengthM * k) / bands
    const rOut = (lengthM * (k + 1)) / bands
    const poly: [number, number][] = []
    // 内側の弧 (左→右)。最内帯 (k=0) は中心 1 点に縮退する。
    if (rIn === 0) {
      poly.push(center)
    } else {
      for (let i = 0; i < angles.length; i++) poly.push(project(rIn, angles[i]))
    }
    // 外側の弧 (右→左) で扇帯を閉じる。
    for (let i = angles.length - 1; i >= 0; i--) poly.push(project(rOut, angles[i]))

    const midT = (k + 0.5) / bands // 0(中心)..1(外周)
    result.push({ polygon: poly, alpha: Math.pow(1 - midT, 1.6) })
  }
  return result
}
