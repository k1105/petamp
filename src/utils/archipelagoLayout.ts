import type { Run } from '../types'
import { acceptedPoints } from './recordingFilters'
import { groupRunsByBboxOverlap } from './runGroups'
import { nodesFromSamples } from './terrainShared'

export interface ArchipelagoParams {
  gridSize: number
  radius: number
  power: number
  seaFloor: number
  baseWeight: number
  zScale: number
  contourInterval: number
  opacity: number
  islandMargin: number
  layoutIterations: number
  groupMargin: number
  seaPalette: string
}

export const DEFAULT_ARCHIPELAGO_PARAMS: ArchipelagoParams = {
  gridSize: 400,
  radius: 90,
  power: 2,
  seaFloor: -5,
  baseWeight: 0.02,
  zScale: 1,
  contourInterval: 10,
  opacity: 1,
  islandMargin: 100,
  layoutIterations: 130,
  groupMargin: 100,
  seaPalette: 'azure',
}

export interface ArchipelagoLayoutResult {
  origin: { lng: number; lat: number }
  mPerDegLng: number
  mPerDegLat: number
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  /** 描画用 polyline 一覧。1 グループに複数 polyline (Run) を含む。 */
  islands: { nodes: { x: number; y: number; alt: number }[] }[]
  /** グループ (= 1 つの島) 単位の bbox / 中心 / ラベル用の原座標。 */
  groups: {
    id: string
    runIds: string[]
    /** 統合フレーム (METER_OFFSETS) 内の中心。 */
    center: { x: number; y: number }
    /** 統合フレーム内の bbox。 */
    bbox: { minX: number; minY: number; maxX: number; maxY: number }
    /** グループ内の最高標高 (m)。 */
    maxAlt: number
    /** force-directed 前の地理的中心 (lng, lat)。reverse geocode 用。 */
    geographicCenter: { lng: number; lat: number }
    /**
     * force-directed で適用された変位 (= group ローカル原点を統合フレームに移すオフセット)。
     * 外部 (例: NamedPlace) の lng/lat を統合フレームに変換するのに使う:
     *   x = (lng - geographicCenter.lng) * mPerDegLng_atGroupLat + displacement.x
     *   y = (lat - geographicCenter.lat) * mPerDegLat                 + displacement.y
     */
    displacement: { x: number; y: number }
  }[]
}

/**
 * 力学レイアウト: 各島を反発力 + 弱い中心引力で配置。
 */
function layoutIslands(
  islands: { islandRadius: number }[],
  margin: number,
  iterations: number,
): { x: number; y: number }[] {
  const n = islands.length
  if (n === 0) return []
  if (n === 1) return [{ x: 0, y: 0 }]

  const sumD = islands.reduce((s, i) => s + (i.islandRadius * 2 + margin), 0)
  const ringR = Math.max(1, sumD / (2 * Math.PI))
  const positions: { x: number; y: number }[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const theta = (i / n) * Math.PI * 2
    positions[i] = { x: Math.cos(theta) * ringR, y: Math.sin(theta) * ringR }
  }

  const centerPull = 0.01
  const repulse = 1.0
  for (let it = 0; it < iterations; it++) {
    const forces = positions.map(() => ({ x: 0, y: 0 }))
    for (let i = 0; i < n; i++) {
      forces[i].x -= positions[i].x * centerPull
      forces[i].y -= positions[i].y * centerPull
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = positions[i].x - positions[j].x
        const dy = positions[i].y - positions[j].y
        const d2 = dx * dx + dy * dy
        const d = Math.sqrt(d2) || 0.001
        const minDist = islands[i].islandRadius + islands[j].islandRadius + margin
        if (d < minDist) {
          const overlap = (minDist - d) * 0.5 * repulse
          const ux = dx / d
          const uy = dy / d
          forces[i].x += ux * overlap
          forces[i].y += uy * overlap
          forces[j].x -= ux * overlap
          forces[j].y -= uy * overlap
        }
      }
    }
    for (let i = 0; i < n; i++) {
      positions[i].x += forces[i].x
      positions[i].y += forces[i].y
    }
  }
  return positions
}

interface GroupPrep {
  id: string
  runIds: string[]
  geographicCenter: { lng: number; lat: number }
  polylines: { nodes: { x: number; y: number; alt: number }[] }[]
  islandRadius: number
}

/**
 * 群島レイアウトを計算する純関数。Run[] を空間的に近接するグループにまとめ、
 * 各グループを力学レイアウトで配置する。
 */
export function computeArchipelagoLayout(
  runs: Run[],
  rawParams?: Partial<ArchipelagoParams>,
): ArchipelagoLayoutResult | null {
  const params: ArchipelagoParams = { ...DEFAULT_ARCHIPELAGO_PARAMS, ...(rawParams ?? {}) }
  if (runs.length === 0) return null

  // 統合 origin: 最初の有効 run の中心。
  let originLng = 0
  let originLat = 35
  for (const r of runs) {
    const pts = acceptedPoints(r.trackPoints)
    if (pts.length < 2) continue
    let mnLng = Infinity, mxLng = -Infinity, mnLat = Infinity, mxLat = -Infinity
    for (const p of pts) {
      if (p.lng < mnLng) mnLng = p.lng
      if (p.lng > mxLng) mxLng = p.lng
      if (p.lat < mnLat) mnLat = p.lat
      if (p.lat > mxLat) mxLat = p.lat
    }
    originLng = (mnLng + mxLng) / 2
    originLat = (mnLat + mxLat) / 2
    break
  }
  const mPerDegLat = 111320
  const mPerDegLng = 111320 * Math.cos((originLat * Math.PI) / 180)

  const runGroups = groupRunsByBboxOverlap(runs, params.groupMargin)
  if (runGroups.length === 0) return null
  const runById = new Map(runs.map(r => [r.id, r]))

  const minSpacing = Math.max(2, params.radius * 0.05)
  const groupPreps: GroupPrep[] = []
  for (const g of runGroups) {
    const gcLng = g.center[0]
    const gcLat = g.center[1]
    const gMpdLng = 111320 * Math.cos((gcLat * Math.PI) / 180)

    const polylines: { nodes: { x: number; y: number; alt: number }[] }[] = []
    for (const rid of g.runIds) {
      const r = runById.get(rid)
      if (!r) continue
      const samples: { lng: number; lat: number; alt: number }[] = []
      for (const p of acceptedPoints(r.trackPoints)) {
        const a = p.altitude
        if (a != null) samples.push({ lng: p.lng - gcLng, lat: p.lat - gcLat, alt: a })
      }
      if (samples.length < 2) continue
      const nodes = nodesFromSamples(
        samples,
        { lng: 0, lat: 0 },
        gMpdLng,
        mPerDegLat,
        minSpacing,
      )
      if (nodes.length >= 2) polylines.push({ nodes })
    }
    if (polylines.length === 0) continue

    let maxR2 = 0
    for (const pl of polylines) {
      for (const n of pl.nodes) {
        const r2 = n.x * n.x + n.y * n.y
        if (r2 > maxR2) maxR2 = r2
      }
    }
    const islandRadius = Math.sqrt(maxR2) + params.radius

    groupPreps.push({
      id: g.id,
      runIds: g.runIds,
      geographicCenter: { lng: gcLng, lat: gcLat },
      polylines,
      islandRadius,
    })
  }
  if (groupPreps.length === 0) return null

  const positions = layoutIslands(groupPreps, params.islandMargin, params.layoutIterations)

  const islands: { nodes: { x: number; y: number; alt: number }[] }[] = []
  const groups: ArchipelagoLayoutResult['groups'] = []
  for (let gi = 0; gi < groupPreps.length; gi++) {
    const px = positions[gi].x
    const py = positions[gi].y
    let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity
    let gMaxAlt = -Infinity
    for (const pl of groupPreps[gi].polylines) {
      const moved = pl.nodes.map((n) => {
        const x = n.x + px
        const y = n.y + py
        if (x < gMinX) gMinX = x
        if (x > gMaxX) gMaxX = x
        if (y < gMinY) gMinY = y
        if (y > gMaxY) gMaxY = y
        if (n.alt > gMaxAlt) gMaxAlt = n.alt
        return { x, y, alt: n.alt }
      })
      islands.push({ nodes: moved })
    }
    groups.push({
      id: groupPreps[gi].id,
      runIds: groupPreps[gi].runIds,
      center: { x: (gMinX + gMaxX) / 2, y: (gMinY + gMaxY) / 2 },
      bbox: { minX: gMinX, minY: gMinY, maxX: gMaxX, maxY: gMaxY },
      maxAlt: gMaxAlt === -Infinity ? 0 : gMaxAlt,
      geographicCenter: groupPreps[gi].geographicCenter,
      displacement: { x: px, y: py },
    })
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let gi = 0; gi < groupPreps.length; gi++) {
    const r = groupPreps[gi].islandRadius
    const px = positions[gi].x
    const py = positions[gi].y
    if (px - r < minX) minX = px - r
    if (px + r > maxX) maxX = px + r
    if (py - r < minY) minY = py - r
    if (py + r > maxY) maxY = py + r
  }
  const pad = params.radius
  minX -= pad
  maxX += pad
  minY -= pad
  maxY += pad

  return {
    origin: { lng: originLng, lat: originLat },
    mPerDegLng,
    mPerDegLat,
    bounds: { minX, minY, maxX, maxY },
    islands,
    groups,
  }
}
