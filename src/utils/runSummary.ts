import type { Run } from '../types'
import type { RunSummary } from '../character'
import { elevationGain, elevationLoss, totalDistance } from './geoUtils'
import { acceptedPoints } from './recordingFilters'
import { buildBehaviorSegments } from './runSegments'
import { detectRunEvents } from './runEvents'
import { analyzeRunTopology } from './runTopology'
import { computePaceDistribution } from './runPaceDistribution'

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

  const segments = buildBehaviorSegments(run)
  const rawEvents = detectRunEvents(run, segments)
  const topology = analyzeRunTopology(run)
  const paceDistribution = computePaceDistribution(run)
  // out_and_back では revisit が当然発生するため、特徴ポイントから除外。
  // u_turn も折り返し点として topology から自明なので情報量が低い。
  const events = topology.shape === 'out_and_back'
    ? rawEvents.filter(e => e.kind !== 'revisit' && e.kind !== 'u_turn')
    : rawEvents

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
    stopCount: segments.filter(s => s.behavior === 'resting').length,
    noteCount: run.notes.length,
    segments,
    events,
    topology,
    paceDistribution,
  }
}
