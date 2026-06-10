import type { Run, TrackPoint } from '../types'
import { acceptedPoints } from './recordingFilters'
import { bearing, haversineDistance } from './geoUtils'

const WINDOW_M = 50

interface SpeedBin {
  /** 下限 km/h (含む) */
  from: number
  /** 上限 km/h (含まない、最終 bin のみ Infinity) */
  to: number
  /** この帯に該当した距離 (m) */
  distanceM: number
}

interface DirectionBin {
  /** 方位ラベル */
  label: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'
  /** 中心方位 (deg, 0=N) */
  centerDeg: number
  /** この方位に進んだ距離 (m) */
  distanceM: number
}

export interface RunStatsAggregate {
  totalDistanceM: number
  totalDurationSec: number
  runCount: number
  speedHistogram: SpeedBin[]
  directionBins: DirectionBin[]
  /** 距離加重平均速度 (km/h)。データが無ければ null。 */
  averageSpeedKmh: number | null
}

const SPEED_BIN_WIDTH_KMH = 2
const SPEED_BIN_COUNT = 9 // 0-2, 2-4, ... 16-18+

function makeEmptySpeedBins(): SpeedBin[] {
  const bins: SpeedBin[] = []
  for (let i = 0; i < SPEED_BIN_COUNT; i++) {
    const from = i * SPEED_BIN_WIDTH_KMH
    const to = i === SPEED_BIN_COUNT - 1 ? Infinity : from + SPEED_BIN_WIDTH_KMH
    bins.push({ from, to, distanceM: 0 })
  }
  return bins
}

const DIRECTION_LABELS: DirectionBin['label'][] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

function makeEmptyDirectionBins(): DirectionBin[] {
  return DIRECTION_LABELS.map((label, i) => ({
    label,
    centerDeg: i * 45,
    distanceM: 0,
  }))
}

/** 0=N の方位を 8 方位 bin インデックス (N=0, NE=1, ...) に丸める。 */
function bearingToBinIndex(deg: number): number {
  const normalized = ((deg % 360) + 360) % 360
  return Math.round(normalized / 45) % 8
}

function accumulateWindowsForRun(
  points: TrackPoint[],
  speedBins: SpeedBin[],
  directionBins: DirectionBin[],
): { distanceM: number; durationSec: number } {
  if (points.length < 2) return { distanceM: 0, durationSec: 0 }

  let totalDist = 0
  let totalDur = 0
  let accDist = 0
  let windowStartIdx = 0

  const flushWindow = (endIdx: number) => {
    if (accDist <= 0) return
    const start = points[windowStartIdx]
    const end = points[endIdx]
    const dtSec = (end.timestamp - start.timestamp) / 1000
    if (dtSec <= 0) return
    const speedKmh = (accDist / dtSec) * 3.6
    const binIdx = Math.min(
      SPEED_BIN_COUNT - 1,
      Math.floor(speedKmh / SPEED_BIN_WIDTH_KMH),
    )
    speedBins[binIdx].distanceM += accDist

    const dirDeg = bearing(start, end)
    directionBins[bearingToBinIndex(dirDeg)].distanceM += accDist

    totalDist += accDist
    totalDur += dtSec
  }

  for (let i = 1; i < points.length; i++) {
    accDist += haversineDistance(points[i - 1], points[i])
    if (accDist >= WINDOW_M) {
      flushWindow(i)
      accDist = 0
      windowStartIdx = i
    }
  }
  // 末尾の端数 window: 残距離が WINDOW_M の半分以上あるときだけ採用。
  // ノイズで生じた極小区間が突出して histogram を歪めるのを避ける。
  if (accDist >= WINDOW_M / 2) {
    flushWindow(points.length - 1)
  }

  return { distanceM: totalDist, durationSec: totalDur }
}

export function computeRunStatsAggregate(runs: Run[]): RunStatsAggregate {
  const speedHistogram = makeEmptySpeedBins()
  const directionBins = makeEmptyDirectionBins()
  let totalDistanceM = 0
  let totalDurationSec = 0
  let runCount = 0

  for (const run of runs) {
    const pts = acceptedPoints(run.trackPoints)
    if (pts.length < 2) continue
    const { distanceM, durationSec } = accumulateWindowsForRun(pts, speedHistogram, directionBins)
    if (distanceM > 0) {
      totalDistanceM += distanceM
      totalDurationSec += durationSec
      runCount += 1
    }
  }

  const averageSpeedKmh =
    totalDurationSec > 0 ? (totalDistanceM / totalDurationSec) * 3.6 : null

  return {
    totalDistanceM,
    totalDurationSec,
    runCount,
    speedHistogram,
    directionBins,
    averageSpeedKmh,
  }
}
