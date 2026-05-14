import type { Run, TrackPoint } from '../types'
import type { RunSegment } from '../character/domain/runSummary'
import { acceptedPoints } from './recordingFilters'
import { elevationGain, elevationLoss, haversineDistance } from './geoUtils'
import {
  classifyBehavior,
  DEFAULT_BEHAVIOR_SEGMENT_PARAMS,
  type BehaviorSegmentParams,
  type BehaviorState,
} from './runBehavior'

interface SegmentBoundary {
  startIdx: number
  endIdx: number
  behavior: BehaviorState
}

/**
 * 振る舞いラベル (resting/walking/running) を連続した区間にまとめてセグメント化する。
 * 距離一様な6等分ではなく、移動状態が変わるところで自然に切れる可変長セグメント。
 *
 * 後処理として
 *  - minSegmentDurationSec 未満の区間を隣の長い方に吸収
 *  - maxSegments を超えたら短い順に隣に併合
 * を適用してプロンプトの読みやすさを保つ。
 */
export function buildBehaviorSegments(
  run: Run,
  params: BehaviorSegmentParams = DEFAULT_BEHAVIOR_SEGMENT_PARAMS,
): RunSegment[] {
  const pts = acceptedPoints(run.trackPoints)
  if (pts.length < 2) return []

  const cumDist = computeCumulativeDistances(pts)
  const totalDist = cumDist[cumDist.length - 1]
  if (totalDist <= 0) return []

  const labels = classifyBehavior(pts, params)

  let bounds: SegmentBoundary[] = []
  let startIdx = 0
  for (let i = 1; i < pts.length; i++) {
    if (labels[i] !== labels[startIdx]) {
      // 境界点 i は両セグメントが共有する (可視化で点列を連続させるため)。
      bounds.push({ startIdx, endIdx: i, behavior: labels[startIdx] })
      startIdx = i
    }
  }
  bounds.push({ startIdx, endIdx: pts.length - 1, behavior: labels[startIdx] })

  bounds = mergeShortSegments(bounds, pts, params.minSegmentDurationSec)
  bounds = capSegmentCount(bounds, pts, params.maxSegments)

  return bounds.map((b, idx) =>
    boundaryToSegment(b, idx, pts, cumDist, run.startedAt),
  )
}

function durationOf(b: SegmentBoundary, pts: TrackPoint[]): number {
  return Math.max(0, (pts[b.endIdx].timestamp - pts[b.startIdx].timestamp) / 1000)
}

/** index i のセグメントを、より長い方の隣と併合した新しい配列を返す。 */
function mergeAt(
  bounds: SegmentBoundary[],
  i: number,
  pts: TrackPoint[],
): SegmentBoundary[] {
  if (bounds.length <= 1) return bounds
  const prev = i > 0 ? bounds[i - 1] : null
  const next = i < bounds.length - 1 ? bounds[i + 1] : null
  const useNext =
    !prev ? true :
    !next ? false :
    durationOf(next, pts) > durationOf(prev, pts)
  if (useNext && next) {
    const merged: SegmentBoundary = {
      startIdx: bounds[i].startIdx,
      endIdx: next.endIdx,
      behavior: next.behavior,
    }
    return [...bounds.slice(0, i), merged, ...bounds.slice(i + 2)]
  }
  if (prev) {
    const merged: SegmentBoundary = {
      startIdx: prev.startIdx,
      endIdx: bounds[i].endIdx,
      behavior: prev.behavior,
    }
    return [...bounds.slice(0, i - 1), merged, ...bounds.slice(i + 1)]
  }
  return bounds
}

function mergeShortSegments(
  bounds: SegmentBoundary[],
  pts: TrackPoint[],
  minSec: number,
): SegmentBoundary[] {
  if (minSec <= 0) return bounds
  let cur = bounds
  while (cur.length > 1) {
    let shortIdx = -1
    let shortDur = Infinity
    for (let i = 0; i < cur.length; i++) {
      const d = durationOf(cur[i], pts)
      if (d < minSec && d < shortDur) {
        shortDur = d
        shortIdx = i
      }
    }
    if (shortIdx < 0) break
    cur = mergeAt(cur, shortIdx, pts)
  }
  return cur
}

function capSegmentCount(
  bounds: SegmentBoundary[],
  pts: TrackPoint[],
  maxN: number,
): SegmentBoundary[] {
  if (maxN <= 0) return bounds
  let cur = bounds
  while (cur.length > maxN) {
    let shortIdx = 0
    let shortDur = durationOf(cur[0], pts)
    for (let i = 1; i < cur.length; i++) {
      const d = durationOf(cur[i], pts)
      if (d < shortDur) {
        shortDur = d
        shortIdx = i
      }
    }
    cur = mergeAt(cur, shortIdx, pts)
  }
  return cur
}

function boundaryToSegment(
  b: SegmentBoundary,
  index: number,
  pts: TrackPoint[],
  cumDist: number[],
  runStartedAt: number,
): RunSegment {
  const slice = pts.slice(b.startIdx, b.endIdx + 1)
  const startTime = pts[b.startIdx].timestamp
  const endTime = pts[b.endIdx].timestamp
  const durationSec = Math.max(0, (endTime - startTime) / 1000)
  const distanceM = cumDist[b.endIdx] - cumDist[b.startIdx]
  return {
    index,
    behavior: b.behavior,
    startDistanceM: cumDist[b.startIdx],
    endDistanceM: cumDist[b.endIdx],
    distanceM,
    startTimeSec: (startTime - runStartedAt) / 1000,
    endTimeSec: (endTime - runStartedAt) / 1000,
    durationSec,
    avgPaceSecPerKm:
      distanceM > 0 ? Math.round((durationSec / distanceM) * 1000) : null,
    elevationGainM: elevationGain(slice),
    elevationLossM: elevationLoss(slice),
    startPointIdx: b.startIdx,
    endPointIdx: b.endIdx,
  }
}

function computeCumulativeDistances(pts: TrackPoint[]): number[] {
  const cum = new Array<number>(pts.length)
  cum[0] = 0
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + haversineDistance(pts[i - 1], pts[i])
  }
  return cum
}

export { computeCumulativeDistances }
