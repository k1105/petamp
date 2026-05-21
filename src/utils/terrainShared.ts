import { COORDINATE_SYSTEM, type Layer } from '@deck.gl/core'
import { PathLayer, SolidPolygonLayer } from '@deck.gl/layers'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'

function lerpColor(
  c0: [number, number, number],
  c1: [number, number, number],
  t: number,
): [number, number, number] {
  const k = Math.max(0, Math.min(1, t))
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * k),
    Math.round(c0[1] + (c1[1] - c0[1]) * k),
    Math.round(c0[2] + (c1[2] - c0[2]) * k),
  ]
}

const FALLBACK_SEA: [number, number, number] = [10, 30, 60]

export const SEA_PALETTE: Record<string, { label: string; rgb: [number, number, number] }> = {
  midnight: { label: '深紺', rgb: [10, 30, 60] },
  ocean: { label: '紺青', rgb: [16, 60, 110] },
  azure: { label: 'コバルト', rgb: [30, 110, 180] },
  sky: { label: '空色', rgb: [120, 180, 220] },
  teal: { label: 'ティール', rgb: [16, 90, 110] },
  cyan: { label: 'シアン', rgb: [50, 160, 180] },
  slate: { label: 'スレート', rgb: [40, 60, 80] },
  ink: { label: '墨', rgb: [10, 18, 30] },
}

export type SeaPaletteId = keyof typeof SEA_PALETTE

export function resolveSea(id: string | undefined): [number, number, number] {
  if (id && id in SEA_PALETTE) return SEA_PALETTE[id as SeaPaletteId].rgb
  return FALLBACK_SEA
}

const LAND_LOW: [number, number, number] = [28, 151, 94] // = #1c975e
const LAND_MID: [number, number, number] = [120, 215, 165]
const LAND_HIGH: [number, number, number] = [205, 240, 220]
const SNOW: [number, number, number] = [245, 252, 248]

export function landColor(alt: number, maxLandAlt: number): [number, number, number] {
  if (maxLandAlt <= 0) return LAND_LOW
  const t = Math.max(0, Math.min(1, alt / maxLandAlt))
  if (t < 0.33) return lerpColor(LAND_LOW, LAND_MID, t / 0.33)
  if (t < 0.75) return lerpColor(LAND_MID, LAND_HIGH, (t - 0.33) / 0.42)
  return lerpColor(LAND_HIGH, SNOW, (t - 0.75) / 0.25)
}

interface TriData {
  polygon: [number, number, number][]
  color: [number, number, number, number]
}

interface ContourLine {
  path: [number, number, number][]
  color: [number, number, number, number]
}

export interface TerrainKernelParams {
  gridSize: number
  radius: number
  power: number
  seaFloor: number
  baseWeight: number
  zScale: number
  contourInterval: number
  opacity: number
  seaPalette?: string
  /** seaPalette より優先。RGB を直接指定して海色を上書きする。 */
  seaColor?: [number, number, number]
}

export interface IslandTrack {
  nodes: { x: number; y: number; alt: number }[]
}

export interface TerrainBuildOpts {
  islands: IslandTrack[]
  origin: { lng: number; lat: number }
  mPerDegLng: number
  mPerDegLat: number
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  params: TerrainKernelParams
  idPrefix: string
}

/**
 * IDW splatting の重みグリッド + 標高グリッドを外に出したもの。
 * weights[idx] が大きいほど周辺サンプル点が密 = polyline が何本も通った場所。
 * 密度パーティクル描画などに使う。
 */
export interface DensityGrid {
  W: number
  H: number
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  weights: Float32Array
  altitudes: Float32Array
  maxWeight: number
}

export interface TerrainBuildResult {
  layers: Layer[]
  density: DensityGrid
}

const EMPTY_DENSITY = (
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): DensityGrid => ({
  W: 0,
  H: 0,
  bounds,
  weights: new Float32Array(0),
  altitudes: new Float32Array(0),
  maxWeight: 0,
})

/**
 * 複数 island の polyline サンプルから IDW で 2D 標高フィールドを構築し、
 * メッシュ + 等高線 + 海背景の deck.gl レイヤを返す。
 * 密度パーティクル等のための重みグリッドも `density` として一緒に返す。
 */
export function buildTerrainLayers(opts: TerrainBuildOpts): TerrainBuildResult {
  const { islands, origin, bounds, params, idPrefix } = opts
  if (islands.length === 0) return { layers: [], density: EMPTY_DENSITY(bounds) }

  const R = Math.max(1, params.radius)
  const ds = Math.max(1, R * 0.1)

  const dense: { x: number; y: number; alt: number }[] = []
  const allNodes: { x: number; y: number; alt: number }[] = []
  for (const island of islands) {
    if (island.nodes.length < 2) continue
    for (const n of island.nodes) allNodes.push(n)
    for (let k = 0; k < island.nodes.length - 1; k++) {
      const a = island.nodes[k]
      const b = island.nodes[k + 1]
      const ex = b.x - a.x
      const ey = b.y - a.y
      const len = Math.sqrt(ex * ex + ey * ey)
      const n = Math.max(1, Math.ceil(len / ds))
      for (let m = 0; m < n; m++) {
        const t = m / n
        dense.push({ x: a.x + t * ex, y: a.y + t * ey, alt: a.alt + t * (b.alt - a.alt) })
      }
    }
    dense.push(island.nodes[island.nodes.length - 1])
  }
  if (dense.length < 2) return { layers: [], density: EMPTY_DENSITY(bounds) }

  const W = Math.max(16, Math.floor(params.gridSize))
  const H = W
  const widthM = bounds.maxX - bounds.minX
  const heightM = bounds.maxY - bounds.minY
  if (widthM <= 0 || heightM <= 0) return { layers: [], density: EMPTY_DENSITY(bounds) }
  const dxCell = widthM / W
  const dyCell = heightM / H

  const wGrid = new Float32Array((W + 1) * (H + 1))
  const waGrid = new Float32Array((W + 1) * (H + 1))
  const power = Math.max(0.5, params.power)
  const eps = Math.max(0.5, ds * 0.5)
  const eps2 = eps * eps
  const reach = R
  const reach2 = reach * reach
  for (const s of dense) {
    const sxL = s.x - bounds.minX
    const syL = s.y - bounds.minY
    const iMin = Math.max(0, Math.floor((sxL - reach) / dxCell))
    const iMax = Math.min(W, Math.ceil((sxL + reach) / dxCell))
    const jMin = Math.max(0, Math.floor((syL - reach) / dyCell))
    const jMax = Math.min(H, Math.ceil((syL + reach) / dyCell))
    for (let j = jMin; j <= jMax; j++) {
      const yy = j * dyCell
      const ddy = yy - syL
      for (let i = iMin; i <= iMax; i++) {
        const xx = i * dxCell
        const ddx = xx - sxL
        const d2 = ddx * ddx + ddy * ddy
        if (d2 > reach2) continue
        const w = Math.pow(d2 + eps2, -power / 2)
        const idx = j * (W + 1) + i
        wGrid[idx] += w
        waGrid[idx] += w * s.alt
      }
    }
  }

  const baseW = Math.max(0.001, params.baseWeight)
  const seaFloor = Math.min(0, params.seaFloor)
  const verts = new Float32Array((W + 1) * (H + 1))
  for (let k = 0; k < verts.length; k++) {
    verts[k] = (waGrid[k] + baseW * seaFloor) / (wGrid[k] + baseW)
  }

  let maxObs = -Infinity
  for (const s of allNodes) if (s.alt > maxObs) maxObs = s.alt
  const maxLandAlt = Math.max(10, maxObs)

  const xAtI = (i: number) => bounds.minX + i * dxCell
  const yAtJ = (j: number) => bounds.minY + j * dyCell
  const altAt = (i: number, j: number) => verts[j * (W + 1) + i]
  const zOf = (alt: number) => (alt > 0 ? alt * params.zScale : 0)

  const alpha = Math.round(Math.max(0, Math.min(1, params.opacity)) * 255)

  const nGridVerts = (W + 1) * (H + 1)
  const posArr: number[] = new Array(nGridVerts * 3)
  const colArr: number[] = new Array(nGridVerts * 3)
  const coastColor = landColor(0, maxLandAlt)
  const coastR = coastColor[0] / 255
  const coastG = coastColor[1] / 255
  const coastB = coastColor[2] / 255
  for (let j = 0; j <= H; j++) {
    for (let i = 0; i <= W; i++) {
      const idx = j * (W + 1) + i
      const alt = verts[idx]
      posArr[idx * 3] = xAtI(i)
      posArr[idx * 3 + 1] = yAtJ(j)
      posArr[idx * 3 + 2] = zOf(alt)
      if (alt > 0) {
        const rgb = landColor(alt, maxLandAlt)
        colArr[idx * 3] = rgb[0] / 255
        colArr[idx * 3 + 1] = rgb[1] / 255
        colArr[idx * 3 + 2] = rgb[2] / 255
      } else {
        colArr[idx * 3] = coastR
        colArr[idx * 3 + 1] = coastG
        colArr[idx * 3 + 2] = coastB
      }
    }
  }

  const hEdge = new Int32Array((H + 1) * W).fill(-1)
  const vEdge = new Int32Array(H * (W + 1)).fill(-1)
  let vertCursor = nGridVerts
  const pushCoastVert = (x: number, y: number) => {
    posArr.push(x, y, 0)
    colArr.push(coastR, coastG, coastB)
    return vertCursor++
  }
  for (let j = 0; j <= H; j++) {
    for (let i = 0; i < W; i++) {
      const a = altAt(i, j)
      const b = altAt(i + 1, j)
      if ((a > 0) !== (b > 0)) {
        const t = a / (a - b)
        const x = xAtI(i) + t * (xAtI(i + 1) - xAtI(i))
        hEdge[j * W + i] = pushCoastVert(x, yAtJ(j))
      }
    }
  }
  for (let j = 0; j < H; j++) {
    for (let i = 0; i <= W; i++) {
      const a = altAt(i, j)
      const b = altAt(i, j + 1)
      if ((a > 0) !== (b > 0)) {
        const t = a / (a - b)
        const y = yAtJ(j) + t * (yAtJ(j + 1) - yAtJ(j))
        vEdge[j * (W + 1) + i] = pushCoastVert(xAtI(i), y)
      }
    }
  }

  const idxArr: number[] = []
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const a = altAt(i, j)
      const b = altAt(i + 1, j)
      const c = altAt(i + 1, j + 1)
      const d = altAt(i, j + 1)
      const mask =
        (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0)
      if (mask === 0) continue
      const vA = j * (W + 1) + i
      const vB = vA + 1
      const vC = vA + (W + 1) + 1
      const vD = vA + (W + 1)
      const eAB = hEdge[j * W + i]
      const eBC = vEdge[j * (W + 1) + i + 1]
      const eCD = hEdge[(j + 1) * W + i]
      const eDA = vEdge[j * (W + 1) + i]
      let poly: number[] | null = null
      switch (mask) {
        case 15:
          idxArr.push(vA, vB, vC, vA, vC, vD)
          continue
        case 1: poly = [vA, eAB, eDA]; break
        case 2: poly = [vB, eBC, eAB]; break
        case 3: poly = [vA, vB, eBC, eDA]; break
        case 4: poly = [vC, eCD, eBC]; break
        case 5:
          idxArr.push(vA, eAB, eDA, vC, eCD, eBC)
          continue
        case 6: poly = [vB, vC, eCD, eAB]; break
        case 7: poly = [vA, vB, vC, eCD, eDA]; break
        case 8: poly = [vD, eDA, eCD]; break
        case 9: poly = [vA, eAB, eCD, vD]; break
        case 10:
          idxArr.push(vB, eBC, eAB, vD, eDA, eCD)
          continue
        case 11: poly = [vA, vB, eBC, eCD, vD]; break
        case 12: poly = [vC, vD, eDA, eBC]; break
        case 13: poly = [vA, eAB, eBC, vC, vD]; break
        case 14: poly = [vB, vC, vD, eDA, eAB]; break
      }
      if (!poly) continue
      for (let k = 1; k < poly.length - 1; k++) {
        idxArr.push(poly[0], poly[k], poly[k + 1])
      }
    }
  }
  const meshPositions = new Float32Array(posArr)
  const meshColors = new Float32Array(colArr)
  const meshIndices = new Uint32Array(idxArr)

  const contourLines: ContourLine[] = []
  const interval = params.contourInterval
  if (interval > 0) {
    let maxF = -Infinity
    for (let k = 0; k < verts.length; k++) {
      const v = verts[k]
      if (v > maxF) maxF = v
    }
    const kMax = Math.floor(maxF / interval)
    const lift = 0.5
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const a = altAt(i, j)
        const b = altAt(i + 1, j)
        const c = altAt(i + 1, j + 1)
        const d = altAt(i, j + 1)
        if (a <= 0 && b <= 0 && c <= 0 && d <= 0) continue
        const x0 = xAtI(i)
        const x1 = xAtI(i + 1)
        const y0 = yAtJ(j)
        const y1 = yAtJ(j + 1)
        const corners = [
          { alt: a, x: x0, y: y0 },
          { alt: b, x: x1, y: y0 },
          { alt: c, x: x1, y: y1 },
          { alt: d, x: x0, y: y1 },
        ]
        for (let kk = 1; kk <= kMax; kk++) {
          const L = kk * interval
          const pts: [number, number, number][] = []
          for (let e = 0; e < 4; e++) {
            const A = corners[e]
            const B = corners[(e + 1) % 4]
            if ((A.alt - L) * (B.alt - L) < 0) {
              const t = (L - A.alt) / (B.alt - A.alt)
              pts.push([
                A.x + t * (B.x - A.x),
                A.y + t * (B.y - A.y),
                L * params.zScale + lift,
              ])
            }
          }
          if (pts.length >= 2) {
            const isMajor = kk % 5 === 0
            const col: [number, number, number, number] = isMajor
              ? [10, 70, 45, 235]
              : [30, 110, 75, 170]
            contourLines.push({ path: [pts[0], pts[1]], color: col })
            if (pts.length === 4) contourLines.push({ path: [pts[2], pts[3]], color: col })
          }
        }
      }
    }
  }

  const seaZ = -0.5
  const seaRgb = params.seaColor ?? resolveSea(params.seaPalette)
  const coordinateOrigin: [number, number, number] = [origin.lng, origin.lat, 0]
  const layers: Layer[] = []
  const seaBg: TriData = {
    polygon: [
      [-180, -85, seaZ],
      [180, -85, seaZ],
      [180, 85, seaZ],
      [-180, 85, seaZ],
    ],
    color: [seaRgb[0], seaRgb[1], seaRgb[2], alpha],
  }
  layers.push(
    new SolidPolygonLayer<TriData>({
      id: `${idPrefix}:sea`,
      data: [seaBg],
      getPolygon: (d) => d.polygon,
      getFillColor: (d) => d.color,
      filled: true,
      extruded: false,
      getPolygonOffset: () => [100, 100],
    }),
  )
  if (meshIndices.length > 0) {
    layers.push(
      new SimpleMeshLayer<{ position: [number, number, number] }>({
        id: `${idPrefix}:mesh`,
        data: [{ position: [0, 0, 0] }],
        mesh: {
          attributes: {
            positions: { value: meshPositions, size: 3 },
            colors: { value: meshColors, size: 3 },
          },
          indices: { value: meshIndices, size: 1 },
        },
        getPosition: (d) => d.position,
        getColor: [255, 255, 255, alpha],
        material: {
          ambient: 1.0,
          diffuse: 0,
          shininess: 1,
          specularColor: [0, 0, 0],
        },
        coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
        coordinateOrigin,
        parameters: {
          depthCompare: 'less-equal',
          depthWriteEnabled: true,
          cullMode: 'none',
        },
      }),
    )
  }
  if (contourLines.length > 0) {
    layers.push(
      new PathLayer<ContourLine>({
        id: `${idPrefix}:contour`,
        data: contourLines,
        getPath: (d) => d.path,
        getColor: (d) => d.color,
        getWidth: 1,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        widthMaxPixels: 2,
        capRounded: true,
        jointRounded: true,
        coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
        coordinateOrigin,
        getPolygonOffset: () => [-200, -200],
      }),
    )
  }

  let maxW = 0
  for (let k = 0; k < wGrid.length; k++) if (wGrid[k] > maxW) maxW = wGrid[k]
  const density: DensityGrid = {
    W,
    H,
    bounds,
    weights: wGrid,
    altitudes: verts,
    maxWeight: maxW,
  }
  return { layers, density }
}

/** 軌跡点列を距離ベース間引きでメートル座標のノード列にする。 */
export function nodesFromSamples(
  samples: { lng: number; lat: number; alt: number }[],
  origin: { lng: number; lat: number },
  mPerDegLng: number,
  mPerDegLat: number,
  minSpacing: number,
): { x: number; y: number; alt: number }[] {
  const nodes: { x: number; y: number; alt: number }[] = []
  const minSp2 = minSpacing * minSpacing
  for (const s of samples) {
    const x = (s.lng - origin.lng) * mPerDegLng
    const y = (s.lat - origin.lat) * mPerDegLat
    if (nodes.length === 0) {
      nodes.push({ x, y, alt: s.alt })
      continue
    }
    const last = nodes[nodes.length - 1]
    const dx = x - last.x
    const dy = y - last.y
    if (dx * dx + dy * dy < minSp2) continue
    nodes.push({ x, y, alt: s.alt })
  }
  return nodes
}
