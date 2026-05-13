import type { TrackPoint } from '../types'

/**
 * Single continuous tube mesh for a path. Avoids the cylinder+sphere split
 * that double-blends at joints when the tube is rendered semi-transparent.
 *
 * Mesh coords are in metres relative to `anchor` (the path's first point).
 * Pass `anchor` to the layer's `getPosition` so deck.gl places the mesh on
 * the world map at the right lng/lat.
 */
export interface TubeMesh {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  anchor: [number, number]
}

const METERS_PER_LAT_DEG = 110540

/** barometric を優先、無ければ GPS altitude。両方 null なら null。 */
export function rawAltitude(p: TrackPoint): number | null {
  if (p.barometricAltitude != null) return p.barometricAltitude
  if (p.altitude != null) return p.altitude
  return null
}

/**
 * 各点の相対高度 (m, 最初に有効な値を 0 基準) を返す。null は直前値を継続、
 * 先頭で値が無い間は 0。スムージングや欠損補間はしない (visualizer 側で後追い)。
 */
export function relativeAltitudes(points: TrackPoint[]): Float32Array {
  const N = points.length
  const out = new Float32Array(N)
  let baseline: number | null = null
  let last = 0
  for (let i = 0; i < N; i++) {
    const v = rawAltitude(points[i])
    if (v != null) {
      if (baseline == null) baseline = v
      last = v - baseline
    }
    out[i] = last
  }
  return out
}

export function buildTubePath(
  points: TrackPoint[],
  radius: number,
  segments: number = 12,
  /** 各点の z オフセット (m)。長さは points と一致。未指定なら平面 (z=0)。 */
  zOffsets?: Float32Array | null,
): TubeMesh | null {
  const N = points.length
  if (N < 2) return null

  const anchorLng = points[0].lng
  const anchorLat = points[0].lat
  const metersPerLngDeg = 111320 * Math.cos((anchorLat * Math.PI) / 180)

  // Local XY (metres) per point.
  const lx = new Float64Array(N)
  const ly = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    lx[i] = (points[i].lng - anchorLng) * metersPerLngDeg
    ly[i] = (points[i].lat - anchorLat) * METERS_PER_LAT_DEG
  }

  const totalRingVerts = N * segments
  const totalVerts = totalRingVerts + 2 // + 2 cap centres
  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)

  // 2 tris per quad × segments × (N-1) gaps + 2 fan caps × segments
  const totalTris = 2 * segments * (N - 1) + 2 * segments
  const indices = new Uint32Array(totalTris * 3)

  // Build rings. Frame at each point: tangent in XY, normal = perpendicular in
  // XY (90° CCW rotation), binormal = world up. Ring vertex offsets sweep the
  // (normal, up) plane, giving a circular cross-section perpendicular to the
  // path direction.
  for (let i = 0; i < N; i++) {
    let tx: number, ty: number
    if (i === 0) {
      tx = lx[1] - lx[0]
      ty = ly[1] - ly[0]
    } else if (i === N - 1) {
      tx = lx[i] - lx[i - 1]
      ty = ly[i] - ly[i - 1]
    } else {
      tx = lx[i + 1] - lx[i - 1]
      ty = ly[i + 1] - ly[i - 1]
    }
    const tlen = Math.hypot(tx, ty)
    if (tlen < 1e-9) {
      tx = 1
      ty = 0
    } else {
      tx /= tlen
      ty /= tlen
    }
    // 90° CCW rotation of (tx,ty) → in-plane normal
    const nx = -ty
    const ny = tx

    const zBase = zOffsets ? zOffsets[i] : 0
    const ringStart = i * segments
    for (let j = 0; j < segments; j++) {
      const angle = (j / segments) * Math.PI * 2
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      const ox = nx * c
      const oy = ny * c
      const oz = s
      const idx = (ringStart + j) * 3
      positions[idx] = lx[i] + ox * radius
      positions[idx + 1] = ly[i] + oy * radius
      positions[idx + 2] = zBase + oz * radius
      normals[idx] = ox
      normals[idx + 1] = oy
      normals[idx + 2] = oz
    }
  }

  // Cap centres at start (idx N*S) and end (idx N*S+1).
  const startCap = totalRingVerts
  const endCap = totalRingVerts + 1
  positions[startCap * 3 + 0] = lx[0]
  positions[startCap * 3 + 1] = ly[0]
  positions[startCap * 3 + 2] = zOffsets ? zOffsets[0] : 0
  positions[endCap * 3 + 0] = lx[N - 1]
  positions[endCap * 3 + 1] = ly[N - 1]
  positions[endCap * 3 + 2] = zOffsets ? zOffsets[N - 1] : 0

  // Cap normals point along the local tangent so flat caps shade reasonably
  // even though the current material uses ambient=1.
  let txS = lx[1] - lx[0]
  let tyS = ly[1] - ly[0]
  const lS = Math.hypot(txS, tyS)
  if (lS > 1e-9) {
    txS /= lS
    tyS /= lS
  }
  normals[startCap * 3 + 0] = -txS
  normals[startCap * 3 + 1] = -tyS
  normals[startCap * 3 + 2] = 0
  let txE = lx[N - 1] - lx[N - 2]
  let tyE = ly[N - 1] - ly[N - 2]
  const lE = Math.hypot(txE, tyE)
  if (lE > 1e-9) {
    txE /= lE
    tyE /= lE
  }
  normals[endCap * 3 + 0] = txE
  normals[endCap * 3 + 1] = tyE
  normals[endCap * 3 + 2] = 0

  let triIdx = 0
  // Body quads.
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments
      const a = i * segments + j
      const b = i * segments + j1
      const c = (i + 1) * segments + j1
      const d = (i + 1) * segments + j
      indices[triIdx++] = a
      indices[triIdx++] = b
      indices[triIdx++] = c
      indices[triIdx++] = a
      indices[triIdx++] = c
      indices[triIdx++] = d
    }
  }
  // Start cap fan (reverse winding so triangles face outward).
  for (let j = 0; j < segments; j++) {
    const j1 = (j + 1) % segments
    indices[triIdx++] = startCap
    indices[triIdx++] = j1
    indices[triIdx++] = j
  }
  // End cap fan.
  const lastRing = (N - 1) * segments
  for (let j = 0; j < segments; j++) {
    const j1 = (j + 1) % segments
    indices[triIdx++] = endCap
    indices[triIdx++] = lastRing + j
    indices[triIdx++] = lastRing + j1
  }

  return { positions, normals, indices, anchor: [anchorLng, anchorLat] }
}

// ---- Memoization ----------------------------------------------------------

const cache = new Map<string, TubeMesh>()

/**
 * Returns the same TubeMesh object for the same (runId, radius, segments,
 * altitudeScale) so deck.gl can keep the GPU buffer cached. trackPoints is
 * assumed immutable once a run is recorded; pass an immutable run.id as the
 * cache key root. altitudeScale === 0 で平面 mesh (z=0)。
 */
export function getTubeMesh(
  runId: string,
  points: TrackPoint[],
  radius: number,
  segments: number = 12,
  altitudeScale: number = 0,
): TubeMesh | null {
  const key = `${runId}:${radius}:${segments}:${points.length}:${altitudeScale}`
  let mesh = cache.get(key)
  if (!mesh) {
    let zOffsets: Float32Array | null = null
    if (altitudeScale > 0) {
      const rel = relativeAltitudes(points)
      zOffsets = new Float32Array(rel.length)
      for (let i = 0; i < rel.length; i++) zOffsets[i] = rel[i] * altitudeScale
    }
    const built = buildTubePath(points, radius, segments, zOffsets)
    if (!built) return null
    mesh = built
    cache.set(key, mesh)
  }
  return mesh
}

export function clearTubeMeshCache() {
  cache.clear()
}
