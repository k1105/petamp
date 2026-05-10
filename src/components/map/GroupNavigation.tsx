import { useEffect } from 'react'
import { useMap } from './BaseMap'
import { expandBboxByMeters, type LngLatBbox } from '../../utils/runBbox'
import type { RunGroup } from '../../utils/runGroups'

interface Props {
  currentGroup: RunGroup | null
  groups: RunGroup[]
  paddingMeters: number
  onGroupChange: (id: string) => void
}

/** When the user pans within ~this many metres of any side of the current
 *  group's padded bbox, we treat that as "tried to leave" and jump. */
const EDGE_THRESHOLD_METERS = 25
const METERS_PER_LAT_DEG = 110540

type EdgeDir = 'n' | 's' | 'e' | 'w'

function detectEdgeDirection(
  center: [number, number],
  paddedBbox: LngLatBbox,
  thresholdMeters: number,
): EdgeDir | null {
  const [lng, lat] = center
  const meanLat = (paddedBbox[0][1] + paddedBbox[1][1]) / 2
  const mPerLng = 111320 * Math.cos((meanLat * Math.PI) / 180)
  const dW = (lng - paddedBbox[0][0]) * mPerLng
  const dE = (paddedBbox[1][0] - lng) * mPerLng
  const dS = (lat - paddedBbox[0][1]) * METERS_PER_LAT_DEG
  const dN = (paddedBbox[1][1] - lat) * METERS_PER_LAT_DEG
  const sides: { side: EdgeDir; d: number }[] = [
    { side: 'w', d: dW },
    { side: 'e', d: dE },
    { side: 's', d: dS },
    { side: 'n', d: dN },
  ]
  sides.sort((a, b) => a.d - b.d)
  if (sides[0].d <= thresholdMeters) return sides[0].side
  return null
}

function pickNextGroup(
  current: RunGroup,
  groups: RunGroup[],
  direction: EdgeDir,
): RunGroup | null {
  let best: { g: RunGroup; dist: number } | null = null
  for (const g of groups) {
    if (g.id === current.id) continue
    const dlng = g.center[0] - current.center[0]
    const dlat = g.center[1] - current.center[1]
    let inDir = false
    if (direction === 'e' && dlng > 0) inDir = true
    else if (direction === 'w' && dlng < 0) inDir = true
    else if (direction === 'n' && dlat > 0) inDir = true
    else if (direction === 's' && dlat < 0) inDir = true
    if (!inDir) continue
    const dist = Math.hypot(dlng, dlat)
    if (!best || dist < best.dist) best = { g, dist }
  }
  return best?.g ?? null
}

/**
 * Phase 3: pan-edge → jump-to-next-group navigation. No indicator UI; the
 * jump itself is the affordance. Triggers on `moveend` so a single drag
 * gesture can resolve into one jump (rather than firing per `move` frame).
 */
export function GroupNavigation({ currentGroup, groups, paddingMeters, onGroupChange }: Props) {
  const { map } = useMap()
  useEffect(() => {
    if (!map || !currentGroup || groups.length < 2) return
    const onMoveEnd = () => {
      const c = map.getCenter()
      const center: [number, number] = [c.lng, c.lat]
      const padded = expandBboxByMeters(currentGroup.bbox, paddingMeters)
      const edge = detectEdgeDirection(center, padded, EDGE_THRESHOLD_METERS)
      if (!edge) return
      const next = pickNextGroup(currentGroup, groups, edge)
      if (!next) return
      onGroupChange(next.id)
    }
    map.on('moveend', onMoveEnd)
    return () => {
      map.off('moveend', onMoveEnd)
    }
  }, [map, currentGroup, groups, paddingMeters, onGroupChange])

  return null
}
