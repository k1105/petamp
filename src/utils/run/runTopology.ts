import type { Run, TrackPoint } from '../../types'
import type { RunSegment, RunTopology, RunTopologyShape } from '../../character/domain/runSummary'
import { acceptedPoints } from '../geo/recordingFilters'
import { haversineDistance, segmentIntersectionPoint2D } from '../geo/geoUtils'

/** 自己交差として記録されている1件分の詳細。可視化/デバッグ用。 */
interface SelfIntersection {
  /** 1本目の segment 開始 index (pts内、accepted ベース)。 */
  i: number
  /** 2本目の segment 開始 index (pts内、accepted ベース)。 */
  j: number
  /** 2 segment の交点座標 [lng, lat]。 */
  lng: number
  lat: number
  /** 経路上で i→j までに進んだ距離 (m)。minPathDistM 閾値の判定に使う値。 */
  pathDistBetween: number
}

/**
 * 経路の形を判定。
 *
 * 平面グラフ的に経路を扱う:
 * - 自己交差を内部頂点 (degree 4) とみなす
 * - start/end が近ければ仮想エッジで閉じてサイクル化
 * - オイラー特性から囲まれた領域数 (enclosedRegions) を導出
 * - 自己交差 k 個 + 閉路: 領域 = k + 1
 * - 自己交差 k 個 + 開路: 領域 = k
 * - 8の字は更に 2 つのローブが均衡している (それぞれ全周長の 30% 以上) ことを確認
 */
export function analyzeRunTopology(run: Run, segments: RunSegment[] = []): RunTopology {
  const pts = acceptedPoints(run.trackPoints)
  if (pts.length < 2) {
    return {
      shape: 'one_way',
      startEndDistanceM: 0,
      selfIntersections: 0,
      enclosedRegions: 0,
      bboxAspectRatio: 1,
      squiggliness: 1,
    }
  }

  const restingRanges = segments
    .filter(s => s.behavior === 'resting')
    .map(s => [s.startPointIdx, s.endPointIdx] as [number, number])

  const startEndDistanceM = haversineDistance(pts[0], pts[pts.length - 1])
  const intersections = findSelfIntersections(pts, restingRanges)
  const selfIntersections = intersections.length
  const bbox = computeBbox(pts)
  const bboxWidthM = haversineDistance(
    { ...pts[0], lat: bbox.latMid, lng: bbox.lngMin },
    { ...pts[0], lat: bbox.latMid, lng: bbox.lngMax },
  )
  const bboxHeightM = haversineDistance(
    { ...pts[0], lat: bbox.latMin, lng: bbox.lngMid },
    { ...pts[0], lat: bbox.latMax, lng: bbox.lngMid },
  )
  const bboxAspectRatio = bboxHeightM > 0 ? bboxWidthM / bboxHeightM : 1
  const diag = Math.sqrt(bboxWidthM ** 2 + bboxHeightM ** 2)

  let totalDist = 0
  for (let i = 1; i < pts.length; i++) {
    totalDist += haversineDistance(pts[i - 1], pts[i])
  }
  const squiggliness = diag > 0 ? totalDist / diag : 1

  const closed = isPathClosed(startEndDistanceM, totalDist)
  const enclosedRegions = closed ? selfIntersections + 1 : selfIntersections
  const shape = decideShape({
    pts,
    intersections,
    closed,
    totalDist,
    enclosedRegions,
  })

  return {
    shape,
    startEndDistanceM,
    selfIntersections,
    enclosedRegions,
    bboxAspectRatio,
    squiggliness,
  }
}

function isPathClosed(startEndDistanceM: number, totalDist: number): boolean {
  return startEndDistanceM < Math.max(50, totalDist * 0.05)
}

interface DecideArgs {
  pts: TrackPoint[]
  intersections: SelfIntersection[]
  closed: boolean
  totalDist: number
  enclosedRegions: number
}

function decideShape(args: DecideArgs): RunTopologyShape {
  const { pts, intersections, closed, totalDist, enclosedRegions } = args

  // 後半が前半をなぞっているなら最優先で out_and_back。
  // (始終点が近い out_and_back を loop と誤判定するのを防ぐ)
  if (looksLikeOutAndBack(pts)) return 'out_and_back'

  if (enclosedRegions === 0) {
    return closed ? 'loop' : 'one_way'
  }

  if (enclosedRegions === 1) {
    return closed ? 'loop' : 'lollipop'
  }

  // enclosedRegions === 2: 8の字候補。ローブの均衡をチェック。
  if (enclosedRegions === 2 && closed && intersections.length === 1) {
    if (lobesBalanced(intersections[0], totalDist)) return 'figure_eight'
    // 片寄っていれば実質ループ。
    return 'loop'
  }

  return 'complex'
}

/**
 * 1点交差で 2 ローブを持つ閉路の、両ローブの経路長バランスを評価。
 * - ローブA: 交差の t1 から t2 までの内側経路
 * - ローブB: start→t1 + t2→end + 仮想閉路エッジ
 * 両方が全周長の minFraction 以上ならバランスしているとみなす。
 */
function lobesBalanced(
  x: SelfIntersection,
  totalDist: number,
  minFraction = 0.35,
): boolean {
  // i→i+1, j→j+1 が交差。t1 ≈ i+1 までの累積距離、t2 ≈ j までの累積距離 と近似。
  const lobeAInner = x.pathDistBetween // i+1 から j まで
  const lobeBOuter = totalDist - lobeAInner // 残り全部 (start→i+1 と j→end と仮想エッジ)
  const cycle = lobeAInner + lobeBOuter
  if (cycle <= 0) return false
  const ratio = Math.min(lobeAInner, lobeBOuter) / cycle
  return ratio >= minFraction
}

/**
 * 後半の点それぞれが、前半のどこかの点に近接しているなら out_and_back と判定。
 */
function looksLikeOutAndBack(pts: TrackPoint[], thresholdM = 30): boolean {
  if (pts.length < 4) return false
  const half = Math.floor(pts.length / 2)
  const first = pts.slice(0, half)
  const second = pts.slice(half)
  let matched = 0
  for (const p of second) {
    for (const q of first) {
      if (haversineDistance(p, q) <= thresholdM) {
        matched++
        break
      }
    }
  }
  return matched / second.length >= 0.5
}

/** 自己交差は経路上で十分離れた segment 同士の交差のみ列挙する。
 * - resting 区間に絡む segment は GPS ジッタ起因の局所交差を生むので除外
 * - 経路距離が minPathDistM 未満の segment ペアは「同じ道を再度通った」と呼べないので除外
 */
function findSelfIntersections(
  pts: TrackPoint[],
  restingRanges: Array<[number, number]> = [],
  minPathDistM = 50,
): SelfIntersection[] {
  if (pts.length < 4) return []

  const cumDist = new Array<number>(pts.length)
  cumDist[0] = 0
  for (let k = 1; k < pts.length; k++) {
    cumDist[k] = cumDist[k - 1] + haversineDistance(pts[k - 1], pts[k])
  }
  const inResting = (idx: number) =>
    restingRanges.some(([s, e]) => idx >= s && idx <= e)

  const out: SelfIntersection[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    if (inResting(i) || inResting(i + 1)) continue
    for (let j = i + 2; j < pts.length - 1; j++) {
      if (i === 0 && j === pts.length - 2) continue
      if (inResting(j) || inResting(j + 1)) continue
      const pathDistBetween = cumDist[j] - cumDist[i + 1]
      if (pathDistBetween < minPathDistM) continue
      const a: [number, number] = [pts[i].lng, pts[i].lat]
      const b: [number, number] = [pts[i + 1].lng, pts[i + 1].lat]
      const c: [number, number] = [pts[j].lng, pts[j].lat]
      const d: [number, number] = [pts[j + 1].lng, pts[j + 1].lat]
      const ip = segmentIntersectionPoint2D(a, b, c, d)
      if (ip) out.push({ i, j, lng: ip[0], lat: ip[1], pathDistBetween })
    }
  }
  return out
}

interface Bbox {
  latMin: number
  latMax: number
  lngMin: number
  lngMax: number
  latMid: number
  lngMid: number
}

function computeBbox(pts: TrackPoint[]): Bbox {
  let latMin = Infinity, latMax = -Infinity, lngMin = Infinity, lngMax = -Infinity
  for (const p of pts) {
    if (p.lat < latMin) latMin = p.lat
    if (p.lat > latMax) latMax = p.lat
    if (p.lng < lngMin) lngMin = p.lng
    if (p.lng > lngMax) lngMax = p.lng
  }
  return {
    latMin, latMax, lngMin, lngMax,
    latMid: (latMin + latMax) / 2,
    lngMid: (lngMin + lngMax) / 2,
  }
}
