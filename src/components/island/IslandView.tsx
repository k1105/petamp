import { useEffect, useMemo, useState } from 'react'
import { COORDINATE_SYSTEM, type Layer } from '@deck.gl/core'
import { IconLayer, TextLayer } from '@deck.gl/layers'
import type { ArchipelagoLayoutResult } from '../../utils/archipelagoLayout'
import { DEFAULT_ARCHIPELAGO_PARAMS } from '../../utils/archipelagoLayout'
import { buildTerrainLayers } from '../../utils/terrainShared'
import { fetchAreaName } from '../../hooks/useReverseGeocode'
import { useActivePalette } from '../../hooks/useActivePalette'
import { hexToRgb } from '../../utils/themePalettes'
import { ArchipelagoMapView, type ArchipelagoBbox } from './ArchipelagoMapView'
import type { Run } from '../../types'
import type { PublicUser } from '../../firebase/userCloud'

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
}

export function IslandView({ layout, loading, socialRuns, ownerByUid }: Props) {
  const { palette } = useActivePalette()
  const seaColor = useMemo<[number, number, number]>(() => hexToRgb(palette.bg), [palette.bg])

  // 各グループの地理的中心から area name を逐次解決する。
  const [groupNames, setGroupNames] = useState<Map<string, string>>(new Map())
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

  const layers = useMemo<Layer[]>(() => {
    if (!layout) return []
    const params = { ...DEFAULT_ARCHIPELAGO_PARAMS, seaColor }
    const terrainLayers = buildTerrainLayers({
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
        const spacingMeters = 18
        const total = uids.length
        uids.forEach((uid, i) => {
          const u = ownerByUid.get(uid)
          if (!u?.photoURL) return
          // 中央に集まりすぎないよう左右に均等配置
          const offset = (i - (total - 1) / 2) * spacingMeters
          ownerAvatars.push({
            position: [g.center.x + offset, g.center.y, labelZ + 6],
            iconUrl: u.photoURL,
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
            coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
            coordinateOrigin,
          }),
        ]
      : []

    return [...terrainLayers, ...labelLayers, ...ownerLayers]
  }, [layout, groupNames, seaColor, socialRuns, ownerByUid])

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
        <div className="island-loading-inner">
          <span className="island-loading-dot" />
          <span className="island-loading-dot" />
          <span className="island-loading-dot" />
          <p className="island-loading-text">
            {loading ? 'ISLAND を計算中…' : 'ISLAND を準備中…'}
          </p>
        </div>
      </div>
    )
  }

  return <ArchipelagoMapView layers={layers} fitBbox={fitBbox} background={palette.bg} />
}
