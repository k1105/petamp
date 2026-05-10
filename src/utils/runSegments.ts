import type { Run, TrackPoint } from '../types'
import type { RunSegment } from '../character/domain/runSummary'
import { acceptedPoints } from './recordingFilters'
import { elevationGain, elevationLoss, haversineDistance } from './geoUtils'

const DEFAULT_SEGMENT_COUNT = 6

/**
 * 距離で等分割したセグメントを返す。最後のセグメントは余りを吸収する。
 * 各セグメントは少なくとも2点を持つ (短すぎるRunは空配列)。
 */
export function buildRunSegments(run: Run, n = DEFAULT_SEGMENT_COUNT): RunSegment[] {
  const pts = acceptedPoints(run.trackPoints)
  if (pts.length < 2) return []

  const cumDist = computeCumulativeDistances(pts)
  const totalDist = cumDist[cumDist.length - 1]
  if (totalDist <= 0) return []

  const segLen = totalDist / n
  const segments: RunSegment[] = []
  let startIdx = 0

  for (let i = 0; i < n; i++) {
    const target = i === n - 1 ? totalDist : (i + 1) * segLen
    let endIdx = startIdx + 1
    while (endIdx < pts.length - 1 && cumDist[endIdx] < target) endIdx++

    const slice = pts.slice(startIdx, endIdx + 1)
    if (slice.length < 2) {
      // ほぼ最終点。スキップして残りを直前セグメントに付ける ─ 起こりにくいがガード
      break
    }

    const startTime = pts[startIdx].timestamp
    const endTime = pts[endIdx].timestamp
    const durationSec = Math.max(0, (endTime - startTime) / 1000)
    const distanceM = cumDist[endIdx] - cumDist[startIdx]

    segments.push({
      index: i,
      startDistanceM: cumDist[startIdx],
      endDistanceM: cumDist[endIdx],
      distanceM,
      startTimeSec: (startTime - run.startedAt) / 1000,
      endTimeSec: (endTime - run.startedAt) / 1000,
      durationSec,
      avgPaceSecPerKm:
        distanceM > 0 ? Math.round((durationSec / distanceM) * 1000) : null,
      elevationGainM: elevationGain(slice),
      elevationLossM: elevationLoss(slice),
      startPointIdx: startIdx,
      endPointIdx: endIdx,
    })

    startIdx = endIdx
  }

  return segments
}

function computeCumulativeDistances(pts: TrackPoint[]): number[] {
  const cum = new Array<number>(pts.length)
  cum[0] = 0
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + haversineDistance(pts[i - 1], pts[i])
  }
  return cum
}

/** 他のutilでも使えるようexport。 */
export { computeCumulativeDistances }
