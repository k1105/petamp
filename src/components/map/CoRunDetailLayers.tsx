import { useEffect, useMemo } from 'react'
import { PathLayer, ScatterplotLayer, IconLayer } from '@deck.gl/layers'
import { useMap, useMapZoom } from './MapContext'
import { DeckOverlay } from './DeckOverlay'
import { FIT_MAX_ZOOM } from './fitConstants'
import { useSettingsStore } from '../../store/useSettingsStore'
import { positionAtTime } from '../../hooks/useGalleryAnimation'
import { buildPathPositions } from '../../utils/tubeMesh'
import { effectiveRadius } from '../../utils/effectiveRadius'
import { acceptedPoints } from '../../utils/recordingFilters'
import { computeRunsBbox, expandBboxByMeters } from '../../utils/runBbox'
import type { CoRunEntry } from '../../hooks/useCoRunReplay'

const AVATAR_DOT_SCALE = 1.2

// 一緒に走ったメンバー全員の軌跡を色分けで重ね、共通の絶対タイムラインで N 本の
// ポリライン + 動点を同時再生する。動点には各メンバーの Google アイコン (円形) を出す。
// 旧 CoRunResultPage の描画をここに統合し、専用画面を廃止した。
export function CoRunDetailLayers({
  entries, absMs, mapVisible, avatars,
}: {
  entries: CoRunEntry[]
  absMs: number
  mapVisible: boolean
  avatars: Map<string, string>
}) {
  const zoom = useMapZoom()
  const { map } = useMap()
  const radii = useSettingsStore(s => s.radii)
  const dotRadius = effectiveRadius(zoom, radii.zoomThreshold, radii.dotRadius)
  const tubeWidth = effectiveRadius(zoom, radii.zoomThreshold, radii.tubeRadius) * 2

  // 全員の軌跡が画面中央に収まるよう fit。entries が変わったら再フィット。
  useEffect(() => {
    if (!map) return
    const bbox = computeRunsBbox(entries.map(e => e.run))
    if (!bbox) return
    map.fitBounds(expandBboxByMeters(bbox, 60), {
      padding: 60,
      duration: 300,
      maxZoom: FIT_MAX_ZOOM,
    })
  }, [map, entries])

  // 軌跡 (ポリライン) はメンバーごとに 1 本、色分け。
  const pathData = useMemo(
    () =>
      entries
        .map(e => ({
          uid: e.uid,
          color: e.color,
          path: buildPathPositions(acceptedPoints(e.run.trackPoints)),
        }))
        .filter(d => d.path.length >= 2),
    [entries],
  )

  const layers = useMemo(() => {
    const pathLayer = new PathLayer<{ uid: string; color: [number, number, number]; path: [number, number, number][] }>({
      id: 'co-run-paths',
      data: pathData,
      getPath: d => d.path,
      // 軌跡はメンバー問わず白で統一。誰の動点かは動点のアイコン/リング色で判別する。
      getColor: [255, 255, 255, 255],
      getWidth: tubeWidth,
      widthUnits: 'meters',
      capRounded: true,
      jointRounded: true,
      billboard: true,
    })

    type Dot = { position: [number, number]; color: [number, number, number]; avatar: string | null }
    const dots: Dot[] = entries
      .map((e): Dot | null => {
        const loopSec = (absMs - e.run.startedAt) / 1000
        const pos = positionAtTime(e.run, loopSec)
        if (!pos) return null
        const avatar = e.photoURL ? avatars.get(e.photoURL) ?? null : null
        return { position: pos, color: e.color, avatar }
      })
      .filter((d): d is Dot => !!d)

    const withAvatar = dots.filter(d => !!d.avatar)
    const withoutAvatar = dots.filter(d => !d.avatar)

    // アイコンの背面にメンバー色のリングを敷いて、どの軌跡の人かを色で結びつける。
    const ringLayer = new ScatterplotLayer<Dot>({
      id: 'co-run-avatar-rings',
      data: withAvatar,
      getPosition: d => [d.position[0], d.position[1], 0],
      getRadius: dotRadius * AVATAR_DOT_SCALE * 2.4,
      radiusUnits: 'meters',
      getFillColor: d => [...d.color, 255],
      billboard: true,
      updateTriggers: { getPosition: absMs },
    })

    const avatarLayer = new IconLayer<Dot>({
      id: 'co-run-avatars',
      data: withAvatar,
      getPosition: d => [d.position[0], d.position[1], 0],
      getIcon: d => ({ url: d.avatar!, width: 128, height: 128, anchorX: 64, anchorY: 64, mask: false }),
      getSize: dotRadius * AVATAR_DOT_SCALE * 4,
      sizeUnits: 'meters',
      billboard: true,
      updateTriggers: { getPosition: absMs },
    })

    // アイコン未取得 (photoURL 無し / CORS 失敗) のメンバーは色付き動点で表す。
    const dotLayer = new ScatterplotLayer<Dot>({
      id: 'co-run-dots',
      data: withoutAvatar,
      getPosition: d => [d.position[0], d.position[1], 0],
      getRadius: dotRadius * AVATAR_DOT_SCALE,
      radiusUnits: 'meters',
      getFillColor: d => [...d.color, 255],
      billboard: true,
      updateTriggers: { getPosition: absMs },
    })

    return [pathLayer, dotLayer, ringLayer, avatarLayer]
  }, [pathData, entries, absMs, dotRadius, tubeWidth, avatars])

  return <DeckOverlay layers={layers} mode={mapVisible ? 'mapbox' : 'fullscreen'} />
}
