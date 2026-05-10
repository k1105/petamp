import type { Run, TrackPoint } from '../types'
import type { RunSummary } from '../character'
import { elevationGain, smoothAltitudes, totalDistance } from './geoUtils'
import { acceptedPoints } from './recordingFilters'

function elevationLoss(points: TrackPoint[], threshold = 3): number {
  const smoothed = smoothAltitudes(points)
  let loss = 0
  for (let i = 1; i < smoothed.length; i++) {
    const prev = smoothed[i - 1]
    const curr = smoothed[i]
    if (prev === null || curr === null) continue
    const diff = prev - curr
    if (diff > threshold) loss += diff
  }
  return loss
}

function timeOfDayLabel(hour: number): string {
  if (hour < 5) return 'night'
  if (hour < 11) return 'morning'
  if (hour < 15) return 'noon'
  if (hour < 18) return 'afternoon'
  if (hour < 22) return 'evening'
  return 'night'
}

export function buildRunSummary(run: Run): RunSummary {
  const pts = acceptedPoints(run.trackPoints)
  const distanceM = totalDistance(pts)
  const durationSec = Math.max(0, Math.round((run.finishedAt - run.startedAt) / 1000))
  const startHour = new Date(run.startedAt).getHours()
  const avgPaceSecPerKm =
    distanceM > 0 ? Math.round((durationSec / distanceM) * 1000) : null

  return {
    runId: run.id,
    areaName: run.areaName,
    startedAt: run.startedAt,
    durationSec,
    distanceM,
    elevationGainM: elevationGain(pts),
    elevationLossM: elevationLoss(pts),
    avgPaceSecPerKm,
    timeOfDay: timeOfDayLabel(startHour),
    stopCount: 0,
    noteCount: run.notes.length,
  }
}
