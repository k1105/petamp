import type { Run, TrackPoint } from '../types'
import type { RunTopology, RunTopologyShape } from '../character/domain/runSummary'
import { acceptedPoints } from './recordingFilters'
import { haversineDistance, segmentsIntersect2D } from './geoUtils'

/**
 * 経路の形を判定。
 * - shape: loop/out_and_back/one_way/figure_eight
 * - 自己交差は粗い手法 (隣接していない segment 同士の交差をスキャン)
 */
export function analyzeRunTopology(run: Run): RunTopology {
  const pts = acceptedPoints(run.trackPoints)
  if (pts.length < 2) {
    return {
      shape: 'one_way',
      startEndDistanceM: 0,
      selfIntersections: 0,
      bboxAspectRatio: 1,
      squiggliness: 1,
    }
  }

  const startEndDistanceM = haversineDistance(pts[0], pts[pts.length - 1])
  const selfIntersections = countSelfIntersections(pts)
  const bbox = computeBbox(pts)
  const bboxWidthM = haversineDistance(
    { ...pts[0], lat: bbox.latMid, lng: bbox.lngMin },
    { ...pts[0], lat: bbox.latMid, lng: bbox.lngMax },
  )
  const bboxHeightM = haversineDistance(
    { ...pts[0], lat: bbox.latMin, lng: bbox.lngMid },
    { ...pts[0], lat: bbox.latMax, lng: bbox.lngMid },
  )
  const bboxAspectRatio =
    bboxHeightM > 0 ? bboxWidthM / bboxHeightM : 1
  const diag = Math.sqrt(bboxWidthM ** 2 + bboxHeightM ** 2)

  let totalDist = 0
  for (let i = 1; i < pts.length; i++) {
    totalDist += haversineDistance(pts[i - 1], pts[i])
  }
  const squiggliness = diag > 0 ? totalDist / diag : 1

  const shape = decideShape(startEndDistanceM, totalDist, selfIntersections, pts)

  return {
    shape,
    startEndDistanceM,
    selfIntersections,
    bboxAspectRatio,
    squiggliness,
  }
}

function decideShape(
  startEndDist: number,
  totalDist: number,
  selfIntersections: number,
  pts: TrackPoint[],
): RunTopologyShape {
  // 後半が前半の道を再利用しているなら out_and_back を最優先で判定。
  // (始終点が近い out_and_back を loop と誤判定するのを防ぐ)
  if (looksLikeOutAndBack(pts)) return 'out_and_back'
  // 始終点が近く、かつ retrace していない → loop or figure_eight
  if (startEndDist < Math.max(50, totalDist * 0.05)) {
    if (selfIntersections >= 1) return 'figure_eight'
    return 'loop'
  }
  return 'one_way'
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

function countSelfIntersections(pts: TrackPoint[]): number {
  if (pts.length < 4) return 0
  let count = 0
  // segmentが lat/lng を 2D とみなして交差判定。隣接および1点共有はスキップ。
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = i + 2; j < pts.length - 1; j++) {
      // 同じ点を共有する segment はスキップ (path closure点)
      if (i === 0 && j === pts.length - 2) continue
      const a: [number, number] = [pts[i].lng, pts[i].lat]
      const b: [number, number] = [pts[i + 1].lng, pts[i + 1].lat]
      const c: [number, number] = [pts[j].lng, pts[j].lat]
      const d: [number, number] = [pts[j + 1].lng, pts[j + 1].lat]
      if (segmentsIntersect2D(a, b, c, d)) count++
    }
  }
  return count
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
