import { useEffect, useMemo, useState } from 'react'
import { COORDINATE_SYSTEM, type Layer } from '@deck.gl/core'
import { IconLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { ArchipelagoLayoutResult } from '../../utils/archipelagoLayout'
import { DEFAULT_ARCHIPELAGO_PARAMS } from '../../utils/archipelagoLayout'
import { buildTerrainLayers, type DensityGrid } from '../../utils/terrainShared'
import { buildPathLabel, smoothPath, type PathChar } from '../../utils/pathLabel'
import { useNamedPlaces } from '../../hooks/useNamedPlaces'
import type { NamedPlace } from '../../character/domain/memory'
import { fetchAreaName } from '../../hooks/useReverseGeocode'
import { useActivePalette } from '../../hooks/useActivePalette'
import { hexToRgb } from '../../utils/themePalettes'
import { ArchipelagoMapView, type ArchipelagoBbox } from './ArchipelagoMapView'
import { LoadingEyesBubble } from '../LoadingEyesBubble'
import type { Run } from '../../types'
import type { PublicUser } from '../../firebase/userCloud'
import { getCircularAvatar, loadCircularAvatar } from '../../utils/circularAvatar'

interface Props {
  layout: ArchipelagoLayoutResult | null
  loading: boolean
  /** TRAIL/ISLAND タブで表示する全ラン (自分 + フォロー中)。owner 推定用。 */
  socialRuns?: Run[]
  /** uid → PublicUser のルックアップ。フォロー中ユーザーのアイコン解決用。 */
  ownerByUid?: Map<string, PublicUser>
}

type GroupOwnerAvatar = {
  position: [number, number, number]
  iconUrl: string
  /** 画面ピクセル単位のオフセット。島ラベルの直下に並べるために使う。 */
  pixelOffset: [number, number]
}

export function IslandView({ layout, loading, socialRuns, ownerByUid }: Props) {
  const { palette } = useActivePalette()
  const seaColor = useMemo<[number, number, number]>(() => hexToRgb(palette.bg), [palette.bg])
  const { places: namedPlaces } = useNamedPlaces()

  // 各グループの地理的中心から area name を逐次解決する。
  const [groupNames, setGroupNames] = useState<Map<string, string>>(new Map())
  // photoURL → 円形クロップ済み data URL のキャッシュ。
  const [circularAvatars, setCircularAvatars] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    if (!layout) return
    let cancelled = false
    const next = new Map<string, string>()
    Promise.all(
      layout.groups.map(async (g) => {
        const name = await fetchAreaName(g.geographicCenter.lng, g.geographicCenter.lat)
        if (name) next.set(g.id, name)
      }),
    ).then(() => {
      if (!cancelled) setGroupNames(next)
    })
    return () => { cancelled = true }
  }, [layout])

  // ownerByUid に含まれる photoURL を円形にクロップして state に格納する。
  useEffect(() => {
    if (!ownerByUid || ownerByUid.size === 0) return
    let cancelled = false
    const urls: string[] = []
    for (const u of ownerByUid.values()) {
      if (u.photoURL && !getCircularAvatar(u.photoURL)) urls.push(u.photoURL)
    }
    if (urls.length === 0) return
    Promise.all(urls.map((u) => loadCircularAvatar(u).then((d) => [u, d] as const)))
      .then((entries) => {
        if (cancelled) return
        setCircularAvatars((prev) => {
          const next = new Map(prev)
          let changed = false
          for (const [u, d] of entries) {
            if (d && next.get(u) !== d) {
              next.set(u, d)
              changed = true
            }
          }
          return changed ? next : prev
        })
      })
    return () => { cancelled = true }
  }, [ownerByUid])

  const layers = useMemo<Layer[]>(() => {
    if (!layout) return []
    const params = { ...DEFAULT_ARCHIPELAGO_PARAMS, seaColor }
    const { layers: terrainLayers, density } = buildTerrainLayers({
      islands: layout.islands,
      origin: layout.origin,
      mPerDegLng: layout.mPerDegLng,
      mPerDegLat: layout.mPerDegLat,
      bounds: layout.bounds,
      params,
      idPrefix: 'island',
    })

    const coordinateOrigin: [number, number, number] = [layout.origin.lng, layout.origin.lat, 0]
    const islandLabels = layout.groups
      .map((g) => {
        const text = groupNames.get(g.id)
        if (!text) return null
        const labelZ = Math.max(0, g.maxAlt) * params.zScale + 30
        return {
          position: [g.center.x, g.center.y, labelZ] as [number, number, number],
          text,
        }
      })
      .filter((d): d is { position: [number, number, number]; text: string } => d !== null)

    const labelLayers: Layer[] = islandLabels.length > 0
      ? [
          new TextLayer({
            id: 'island:label',
            data: islandLabels,
            getPosition: (d) => d.position,
            getText: (d) => d.text,
            getSize: 16,
            getColor: [255, 255, 255, 255],
            fontWeight: 'bold',
            background: false,
            billboard: true,
            sizeUnits: 'pixels',
            characterSet: 'auto',
            coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
            coordinateOrigin,
          }),
        ]
      : []

    // フォロー中ユーザーのランを含む島には、グループ中心の少し横にユーザーアイコンを並べる。
    // 同一島に複数 owner がいる場合は横方向にオフセットして重ならないようにする。
    const ownerAvatars: GroupOwnerAvatar[] = []
    if (socialRuns && ownerByUid && socialRuns.length > 0) {
      const runById = new Map<string, Run>()
      for (const r of socialRuns) runById.set(r.id, r)
      for (const g of layout.groups) {
        const uidSet = new Set<string>()
        for (const rid of g.runIds) {
          const r = runById.get(rid)
          if (r?.ownerUid) uidSet.add(r.ownerUid)
        }
        if (uidSet.size === 0) continue
        const labelZ = Math.max(0, g.maxAlt) * params.zScale + 30
        const uids = [...uidSet]
        // ラベル (16px) の真下にアイコン (24px) を置く。中心間距離 ≈ 24px。
        const AVATAR_PX = 24
        const SPACING_PX = AVATAR_PX + 2
        const Y_BELOW_LABEL = 26
        const total = uids.length
        uids.forEach((uid, i) => {
          const u = ownerByUid.get(uid)
          if (!u?.photoURL) return
          // 円形クロップが未完成なら描画しない（読み込み完了後に再 render される）
          const circular = circularAvatars.get(u.photoURL)
          if (!circular) return
          const dx = (i - (total - 1) / 2) * SPACING_PX
          ownerAvatars.push({
            position: [g.center.x, g.center.y, labelZ],
            iconUrl: circular,
            pixelOffset: [dx, Y_BELOW_LABEL],
          })
        })
      }
    }

    const ownerLayers: Layer[] = ownerAvatars.length > 0
      ? [
          new IconLayer<GroupOwnerAvatar>({
            id: 'island:owner-avatars',
            data: ownerAvatars,
            getPosition: (d) => d.position,
            getIcon: (d) => ({
              url: d.iconUrl,
              width: 64,
              height: 64,
              anchorX: 32,
              anchorY: 32,
              mask: false,
            }),
            getSize: 24,
            sizeUnits: 'pixels',
            billboard: true,
            getPixelOffset: (d) => d.pixelOffset,
            coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
            coordinateOrigin,
          }),
        ]
      : []

    const glowLayers = buildDensityGlowLayers(
      density,
      params.zScale,
      coordinateOrigin,
    )

    const placeLayers = buildNamedPlaceLayers(
      namedPlaces,
      layout,
      params.zScale,
      coordinateOrigin,
    )

    return [...terrainLayers, ...glowLayers, ...labelLayers, ...ownerLayers, ...placeLayers]
  }, [layout, groupNames, seaColor, socialRuns, ownerByUid, namedPlaces, circularAvatars])

  const fitBbox = useMemo<ArchipelagoBbox | null>(() => {
    if (!layout) return null
    const { origin, mPerDegLng, mPerDegLat, bounds } = layout
    return {
      minLng: origin.lng + bounds.minX / mPerDegLng,
      maxLng: origin.lng + bounds.maxX / mPerDegLng,
      minLat: origin.lat + bounds.minY / mPerDegLat,
      maxLat: origin.lat + bounds.maxY / mPerDegLat,
    }
  }, [layout])

  if (!layout) {
    return (
      <div className="island-loading">
        <LoadingEyesBubble text={loading ? 'ISLAND を計算中…' : 'ISLAND を準備中…'} />
      </div>
    )
  }

  return <ArchipelagoMapView layers={layers} fitBbox={fitBbox} background={palette.bg} />
}

// ── NamedPlace ラベル ──
//   sourceRunId からその place が属するグループを引いて、real (lng, lat) を
//   layout の統合フレーム (x, y) に変換する。
//   point は billboard テキスト、polyline は path-following テキスト。
const NAME_FONT_SIZE_M = 10
const NAME_CHAR_WIDTH_M = NAME_FONT_SIZE_M * 0.85
const NAME_TANGENT_CHORD_M = NAME_CHAR_WIDTH_M * 2

function buildNamedPlaceLayers(
  places: NamedPlace[],
  layout: ArchipelagoLayoutResult,
  zScale: number,
  coordinateOrigin: [number, number, number],
): Layer[] {
  if (places.length === 0) return []
  const runIdToGroup = new Map<string, ArchipelagoLayoutResult['groups'][number]>()
  for (const g of layout.groups) for (const rid of g.runIds) runIdToGroup.set(rid, g)

  const polylineChars: PathChar[] = []
  const pointLabels: { position: [number, number, number]; text: string }[] = []

  for (const place of places) {
    const group = runIdToGroup.get(place.sourceRunId)
    if (!group) continue
    const gMpdLng = 111320 * Math.cos((group.geographicCenter.lat * Math.PI) / 180)
    const mPerDegLat = 111320
    const toSynth = (p: { lat: number; lng: number }) => ({
      x: (p.lng - group.geographicCenter.lng) * gMpdLng + group.displacement.x,
      y: (p.lat - group.geographicCenter.lat) * mPerDegLat + group.displacement.y,
    })

    if (place.point) {
      const { x, y } = toSynth(place.point)
      pointLabels.push({
        position: [x, y, Math.max(0, group.maxAlt) * zScale + 12],
        text: place.name,
      })
    } else if (place.polyline && place.polyline.length >= 2) {
      // alt はわからないので 0 で運ぶ。z は z_lift だけ持ち上げる。
      const raw = place.polyline.map((p) => {
        const { x, y } = toSynth(p)
        return { x, y, alt: 0 }
      })
      const slice = smoothPath(raw)
      polylineChars.push(
        ...buildPathLabel(slice, place.name, {
          charWidthM: NAME_CHAR_WIDTH_M,
          tangentChordM: NAME_TANGENT_CHORD_M,
          zScale,
          zLift: 1,
        }),
      )
    }
  }

  const out: Layer[] = []
  if (polylineChars.length > 0) {
    out.push(
      new TextLayer<PathChar>({
        id: 'island:named-place-polyline',
        data: polylineChars,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getAngle: (d) => d.angle,
        getSize: NAME_FONT_SIZE_M,
        getColor: [255, 255, 255, 255],
        fontWeight: 'normal',
        background: false,
        billboard: false,
        sizeUnits: 'meters',
        characterSet: 'auto',
        coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
        coordinateOrigin,
      }),
    )
  }
  if (pointLabels.length > 0) {
    out.push(
      new TextLayer({
        id: 'island:named-place-point',
        data: pointLabels,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getSize: 13,
        getColor: [255, 255, 255, 255],
        fontWeight: 'bold',
        background: false,
        billboard: true,
        sizeUnits: 'pixels',
        characterSet: 'auto',
        coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
        coordinateOrigin,
      }),
    )
  }
  return out
}

// ── 密度パーティクル ──
//   IDW splatting で出た重みグリッドをそのまま使う。陸 (alt>0) のセルのみ。
//   セル数が多くなりすぎないよう、解像度に応じて間引く。
const DENSITY_INTENSITY = 0.7
const DENSITY_THRESHOLD = 0.35

function buildDensityGlowLayers(
  density: DensityGrid,
  zScale: number,
  coordinateOrigin: [number, number, number],
): Layer[] {
  if (density.maxWeight <= 0 || density.W <= 0) return []
  type Particle = { position: [number, number, number]; intensity: number }
  const particles: Particle[] = []
  const { W, H, bounds: db } = density
  const dx = (db.maxX - db.minX) / W
  const dy = (db.maxY - db.minY) / H
  const thr = density.maxWeight * DENSITY_THRESHOLD
  const step = Math.max(1, Math.floor(W / 200))
  for (let j = 0; j <= H; j += step) {
    for (let i = 0; i <= W; i += step) {
      const idx = j * (W + 1) + i
      const alt = density.altitudes[idx]
      if (alt <= 0) continue
      const w = density.weights[idx]
      if (w < thr) continue
      const t = Math.min(1, w / density.maxWeight)
      particles.push({
        position: [db.minX + i * dx, db.minY + j * dy, alt * zScale + 2],
        intensity: t,
      })
    }
  }
  if (particles.length === 0) return []
  return [
    new ScatterplotLayer<Particle>({
      id: 'island:density-glow',
      data: particles,
      getPosition: (d) => d.position,
      getRadius: (d) => 2 + d.intensity * 4,
      radiusUnits: 'pixels',
      getFillColor: (d) => [
        255,
        240,
        200,
        Math.round(d.intensity * DENSITY_INTENSITY * 220),
      ],
      stroked: false,
      billboard: true,
      coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
      coordinateOrigin,
      parameters: {
        depthCompare: 'less-equal',
        depthWriteEnabled: false,
      },
    }),
  ]
}
