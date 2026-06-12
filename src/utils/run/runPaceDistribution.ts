import type { Run } from '../../types'
import type { PaceDistribution } from '../../character/domain/runSummary'
import { acceptedPoints } from '../geo/recordingFilters'
import { haversineDistance } from '../geo/geoUtils'

const WINDOW_M = 100
const FAST_THRESHOLD = 0.85   // 平均より15%以上速い
const SLOW_THRESHOLD = 1.15   // 平均より15%以上遅い

/**
 * Runを 100m 窓でペースを計算し、平均との比で fast/normal/slow 帯に振り分けて
 * 各帯が占める距離の比率を返す。
 */
export function computePaceDistribution(run: Run): PaceDistribution {
  const pts = acceptedPoints(run.trackPoints)
  if (pts.length < 2) {
    return {
      fastFraction: 0, normalFraction: 0, slowFraction: 0,
      referencePaceSecPerKm: null,
    }
  }

  // 各窓: 連続する点を距離が WINDOW_M 以上になるまで貯めて、その窓のペースを計算。
  const windows: Array<{ distM: number; durSec: number }> = []
  let accDist = 0
  let accDurStart = pts[0].timestamp

  for (let i = 1; i < pts.length; i++) {
    const d = haversineDistance(pts[i - 1], pts[i])
    accDist += d
    if (accDist >= WINDOW_M) {
      const durSec = (pts[i].timestamp - accDurStart) / 1000
      windows.push({ distM: accDist, durSec })
      accDist = 0
      accDurStart = pts[i].timestamp
    }
  }
  if (accDist > 0) {
    const durSec = (pts[pts.length - 1].timestamp - accDurStart) / 1000
    windows.push({ distM: accDist, durSec })
  }
  if (windows.length === 0) {
    return {
      fastFraction: 0, normalFraction: 0, slowFraction: 0,
      referencePaceSecPerKm: null,
    }
  }

  const totalDist = windows.reduce((s, w) => s + w.distM, 0)
  const totalDur = windows.reduce((s, w) => s + w.durSec, 0)
  if (totalDist <= 0 || totalDur <= 0) {
    return {
      fastFraction: 0, normalFraction: 0, slowFraction: 0,
      referencePaceSecPerKm: null,
    }
  }

  const refPace = (totalDur / totalDist) * 1000   // sec/km

  let fast = 0, normal = 0, slow = 0
  for (const w of windows) {
    if (w.distM <= 0 || w.durSec <= 0) continue
    const pace = (w.durSec / w.distM) * 1000
    const ratio = pace / refPace
    if (ratio <= FAST_THRESHOLD) fast += w.distM
    else if (ratio >= SLOW_THRESHOLD) slow += w.distM
    else normal += w.distM
  }

  return {
    fastFraction: fast / totalDist,
    normalFraction: normal / totalDist,
    slowFraction: slow / totalDist,
    referencePaceSecPerKm: Math.round(refPace),
  }
}
