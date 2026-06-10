import type { Run } from '../types'
import { acceptedPoints } from './recordingFilters'
import { expandBboxByMeters, type LngLatBbox } from './runBbox'

export interface RunGroup {
  /** Stable across re-clustering as long as the same set of runs hashes to it. */
  id: string
  runIds: string[]
  bbox: LngLatBbox
  center: [number, number]
}

function bboxOfRun(run: Run): LngLatBbox | null {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  let any = false
  for (const p of acceptedPoints(run.trackPoints)) {
    if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat)) continue
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    any = true
  }
  if (!any) return null
  return [[minLng, minLat], [maxLng, maxLat]]
}

function bboxesOverlap(a: LngLatBbox, b: LngLatBbox): boolean {
  return !(
    a[1][0] < b[0][0] ||
    a[0][0] > b[1][0] ||
    a[1][1] < b[0][1] ||
    a[0][1] > b[1][1]
  )
}

function unionBboxes(boxes: LngLatBbox[]): LngLatBbox {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const b of boxes) {
    if (b[0][0] < minLng) minLng = b[0][0]
    if (b[0][1] < minLat) minLat = b[0][1]
    if (b[1][0] > maxLng) maxLng = b[1][0]
    if (b[1][1] > maxLat) maxLat = b[1][1]
  }
  return [[minLng, minLat], [maxLng, maxLat]]
}

/**
 * Cluster runs by overlap of their margin-expanded bboxes (Option C in
 * docs/run-grouping.md). Two runs whose expanded bboxes intersect are linked;
 * groups = connected components via Union-Find. Group merges are accepted —
 * mid-area runs that bridge two clusters merge them, which is the documented
 * behaviour for v1.
 */
export function groupRunsByBboxOverlap(runs: Run[], marginMeters: number): RunGroup[] {
  const items: { run: Run; bbox: LngLatBbox; expanded: LngLatBbox }[] = []
  for (const run of runs) {
    const b = bboxOfRun(run)
    if (!b) continue
    items.push({ run, bbox: b, expanded: expandBboxByMeters(b, marginMeters) })
  }
  if (items.length === 0) return []

  const parent = items.map((_, i) => i)
  const find = (i: number): number => {
    let x = i
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  const union = (i: number, j: number) => {
    const ri = find(i)
    const rj = find(j)
    if (ri !== rj) parent[ri] = rj
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (bboxesOverlap(items[i].expanded, items[j].expanded)) union(i, j)
    }
  }

  const byRoot = new Map<number, number[]>()
  for (let i = 0; i < items.length; i++) {
    const r = find(i)
    let arr = byRoot.get(r)
    if (!arr) {
      arr = []
      byRoot.set(r, arr)
    }
    arr.push(i)
  }

  const groups: RunGroup[] = []
  for (const indices of byRoot.values()) {
    const groupBbox = unionBboxes(indices.map(i => items[i].bbox))
    const runIds = indices.map(i => items[i].run.id).sort()
    groups.push({
      id: runIds.join('|'),
      runIds,
      bbox: groupBbox,
      center: [
        (groupBbox[0][0] + groupBbox[1][0]) / 2,
        (groupBbox[0][1] + groupBbox[1][1]) / 2,
      ],
    })
  }
  return groups
}

/** Return the group whose padded bbox contains the given point, else null. */
export function findGroupContaining(
  groups: RunGroup[],
  point: [number, number],
  paddingMeters: number,
): RunGroup | null {
  const [lng, lat] = point
  for (const g of groups) {
    const padded = expandBboxByMeters(g.bbox, paddingMeters)
    if (
      lng >= padded[0][0] &&
      lng <= padded[1][0] &&
      lat >= padded[0][1] &&
      lat <= padded[1][1]
    ) {
      return g
    }
  }
  return null
}

const METERS_PER_LAT_DEG = 110540

/**
 * Synthetic "home" group centred on the user's current GPS — a small fixed-
 * size box that the camera locks to before the user has navigated to a
 * recorded group. Pan-to-edge from here jumps to the nearest real group.
 */
export function makeHomeGroup(
  gps: [number, number],
  halfSizeMeters: number,
): RunGroup {
  const [lng, lat] = gps
  const mPerLng = 111320 * Math.cos((lat * Math.PI) / 180)
  const dLng = halfSizeMeters / mPerLng
  const dLat = halfSizeMeters / METERS_PER_LAT_DEG
  return {
    id: 'home',
    runIds: [],
    bbox: [
      [lng - dLng, lat - dLat],
      [lng + dLng, lat + dLat],
    ],
    center: [lng, lat],
  }
}
