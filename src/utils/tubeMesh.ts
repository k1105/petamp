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

export function buildTubePath(
  points: TrackPoint[],
  radius: number,
  segments: number = 12,
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
      positions[idx + 2] = oz * radius
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
  positions[startCap * 3 + 2] = 0
  positions[endCap * 3 + 0] = lx[N - 1]
  positions[endCap * 3 + 1] = ly[N - 1]
  positions[endCap * 3 + 2] = 0

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
 * Returns the same TubeMesh object for the same (runId, radius, segments) so
 * deck.gl can keep the GPU buffer cached. trackPoints is assumed immutable
 * once a run is recorded; pass an immutable run.id as the cache key root.
 */
export function getTubeMesh(
  runId: string,
  points: TrackPoint[],
  radius: number,
  segments: number = 12,
): TubeMesh | null {
  const key = `${runId}:${radius}:${segments}:${points.length}`
  let mesh = cache.get(key)
  if (!mesh) {
    const built = buildTubePath(points, radius, segments)
    if (!built) return null
    mesh = built
    cache.set(key, mesh)
  }
  return mesh
}

export function clearTubeMeshCache() {
  cache.clear()
}
