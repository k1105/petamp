import type { Run, TrackPoint } from '../../types'
import type { RunEvent, RunSegment } from '../../character/domain/runSummary'
import { acceptedPoints } from '../geo/recordingFilters'
import { bearing, bearingDelta, haversineDistance, smoothAltitudes } from '../geo/geoUtils'
import { computeCumulativeDistances } from './runSegments'

const CLIMB_DELTA_M = 12
const CLIMB_WINDOW_M = 200
const DESCENT_DELTA_M = 12
const U_TURN_DEG = 150
const U_TURN_WINDOW_M = 80
const REVISIT_DISTANCE_M = 12
const REVISIT_MIN_INDEX_GAP = 50
const PACE_ANOMALY_RATIO = 1.25     // |pace/avg - 1| > 0.25 で異常
const MAX_EVENTS = 8

/**
 * Tier 1 のイベント検出。重要度順に上位 MAX_EVENTS 件まで返す。
 * segments は progress→segmentIndex マッピングのため受け取る。
 */
export function detectRunEvents(run: Run, segments: RunSegment[]): RunEvent[] {
  const pts = acceptedPoints(run.trackPoints)
  if (pts.length < 3 || segments.length === 0) return []

  const cumDist = computeCumulativeDistances(pts)
  const totalDist = cumDist[cumDist.length - 1]
  if (totalDist <= 0) return []

  const events: RunEvent[] = []
  const findSeg = (progress: number) => segmentIndexAtProgress(segments, progress, totalDist)

  pushAll(events, detectClimbBursts(pts, cumDist, totalDist, findSeg))
  pushAll(events, detectDescentBursts(pts, cumDist, totalDist, findSeg))
  pushAll(events, detectUTurns(pts, cumDist, totalDist, findSeg))
  pushAll(events, detectRevisits(pts, cumDist, totalDist, findSeg))
  pushAll(events, detectPaceAnomalies(segments))

  return rankAndCap(events)
}

function pushAll(into: RunEvent[], more: RunEvent[]): void {
  for (const e of more) into.push(e)
}

function segmentIndexAtProgress(
  segments: RunSegment[],
  progress: number,
  totalDist: number,
): number {
  const dist = progress * totalDist
  for (const s of segments) {
    if (dist <= s.endDistanceM + 1e-6) return s.index
  }
  return segments[segments.length - 1].index
}

function detectClimbBursts(
  pts: TrackPoint[], cumDist: number[], totalDist: number,
  findSeg: (p: number) => number,
): RunEvent[] {
  return detectAltitudeBursts(pts, cumDist, totalDist, findSeg, 'climb_burst', CLIMB_DELTA_M, CLIMB_WINDOW_M)
}

function detectDescentBursts(
  pts: TrackPoint[], cumDist: number[], totalDist: number,
  findSeg: (p: number) => number,
): RunEvent[] {
  return detectAltitudeBursts(pts, cumDist, totalDist, findSeg, 'descent_burst', -DESCENT_DELTA_M, CLIMB_WINDOW_M)
}

/**
 * 距離窓内の高さ変化が閾値超なら burst。delta が正なら上昇、負なら下降。
 */
function detectAltitudeBursts(
  pts: TrackPoint[], cumDist: number[], totalDist: number,
  findSeg: (p: number) => number,
  kind: 'climb_burst' | 'descent_burst',
  deltaThresholdM: number, windowM: number,
): RunEvent[] {
  const smoothed = smoothAltitudes(pts)
  const out: RunEvent[] = []
  let i = 0
  while (i < pts.length - 1) {
    let j = i + 1
    while (j < pts.length && cumDist[j] - cumDist[i] < windowM) j++
    if (j >= pts.length) break
    const a = smoothed[i]
    const b = smoothed[j]
    if (a === null || b === null) { i++; continue }
    const diff = b - a
    if ((deltaThresholdM > 0 && diff >= deltaThresholdM) ||
        (deltaThresholdM < 0 && diff <= deltaThresholdM)) {
      const midIdx = Math.floor((i + j) / 2)
      const progress = cumDist[midIdx] / totalDist
      out.push({
        kind,
        progress,
        segmentIndex: findSeg(progress),
        value: Math.round(Math.abs(diff)),
        description: kind === 'climb_burst'
          ? `${Math.round(Math.abs(diff))}m の急なのぼり`
          : `${Math.round(Math.abs(diff))}m の急なくだり`,
      })
      i = j   // skip past this burst
    } else {
      i++
    }
  }
  return out
}

function detectUTurns(
  pts: TrackPoint[], cumDist: number[], totalDist: number,
  findSeg: (p: number) => number,
): RunEvent[] {
  const out: RunEvent[] = []
  if (pts.length < 4) return out

  let i = 1
  while (i < pts.length - 1) {
    // 直前 ~U_TURN_WINDOW_M の方向と、直後 ~U_TURN_WINDOW_M の方向を比較
    const before = lookBack(pts, cumDist, i, U_TURN_WINDOW_M)
    const after = lookForward(pts, cumDist, i, U_TURN_WINDOW_M)
    if (!before || !after) { i++; continue }
    const b1 = bearing(before, pts[i])
    const b2 = bearing(pts[i], after)
    const delta = Math.abs(bearingDelta(b1, b2))
    if (delta >= U_TURN_DEG) {
      const progress = cumDist[i] / totalDist
      out.push({
        kind: 'u_turn',
        progress,
        segmentIndex: findSeg(progress),
        value: Math.round(delta),
        description: 'おりかえした',
      })
      // 次の候補までスキップして同じ折り返しを多重カウントしない
      let j = i + 1
      while (j < pts.length && cumDist[j] - cumDist[i] < U_TURN_WINDOW_M * 2) j++
      i = j
    } else {
      i++
    }
  }
  return out
}

function lookBack(pts: TrackPoint[], cumDist: number[], i: number, windowM: number): TrackPoint | null {
  for (let j = i - 1; j >= 0; j--) {
    if (cumDist[i] - cumDist[j] >= windowM) return pts[j]
  }
  return pts[0]
}

function lookForward(pts: TrackPoint[], cumDist: number[], i: number, windowM: number): TrackPoint | null {
  for (let j = i + 1; j < pts.length; j++) {
    if (cumDist[j] - cumDist[i] >= windowM) return pts[j]
  }
  return null
}

function detectRevisits(
  pts: TrackPoint[], cumDist: number[], totalDist: number,
  findSeg: (p: number) => number,
): RunEvent[] {
  const out: RunEvent[] = []
  // 各点iについて、十分前(j < i - GAP)の中に近接点があれば revisit
  for (let i = REVISIT_MIN_INDEX_GAP; i < pts.length; i++) {
    let nearestJ = -1
    let nearestD = Infinity
    for (let j = 0; j < i - REVISIT_MIN_INDEX_GAP; j++) {
      const d = haversineDistance(pts[i], pts[j])
      if (d < nearestD) {
        nearestD = d
        nearestJ = j
      }
    }
    if (nearestD <= REVISIT_DISTANCE_M && nearestJ >= 0) {
      const progress = cumDist[i] / totalDist
      out.push({
        kind: 'revisit',
        progress,
        segmentIndex: findSeg(progress),
        value: Math.round(nearestD),
        description: '前にもおなじところを通った',
      })
      // 連続revisitはスキップ
      i += REVISIT_MIN_INDEX_GAP
    }
  }
  return out
}

function detectPaceAnomalies(segments: RunSegment[]): RunEvent[] {
  if (segments.length === 0) return []
  const paces = segments
    .map(s => s.avgPaceSecPerKm)
    .filter((p): p is number => p !== null)
  if (paces.length === 0) return []
  const avg = paces.reduce((a, b) => a + b, 0) / paces.length

  const out: RunEvent[] = []
  for (const s of segments) {
    if (s.avgPaceSecPerKm === null) continue
    const ratio = s.avgPaceSecPerKm / avg
    if (ratio >= PACE_ANOMALY_RATIO) {
      const progress = (s.startDistanceM + s.endDistanceM) / 2 /
        Math.max(1, segments[segments.length - 1].endDistanceM)
      out.push({
        kind: 'pace_anomaly_slow',
        progress,
        segmentIndex: s.index,
        value: ratio,
        description: 'ふだんよりゆっくり走っていた',
      })
    } else if (ratio <= 1 / PACE_ANOMALY_RATIO) {
      const progress = (s.startDistanceM + s.endDistanceM) / 2 /
        Math.max(1, segments[segments.length - 1].endDistanceM)
      out.push({
        kind: 'pace_anomaly_fast',
        progress,
        segmentIndex: s.index,
        value: ratio,
        description: 'ふだんよりはやく走っていた',
      })
    }
  }
  return out
}

/**
 * 重要度スコアを計算して上位 MAX_EVENTS だけ返す。
 * スコアは kind のベース重み + 値の大きさ。
 */
function rankAndCap(events: RunEvent[]): RunEvent[] {
  const score = (e: RunEvent): number => {
    switch (e.kind) {
      case 'u_turn': return 100 + e.value * 0.1
      case 'revisit': return 80
      case 'climb_burst': return 60 + e.value
      case 'descent_burst': return 40 + e.value
      case 'pace_anomaly_slow':
      case 'pace_anomaly_fast': return 30 + Math.abs(1 - e.value) * 100
    }
  }
  return events
    .slice()
    .sort((a, b) => score(b) - score(a))
    .slice(0, MAX_EVENTS)
    .sort((a, b) => a.progress - b.progress) // 表示は時系列順
}
