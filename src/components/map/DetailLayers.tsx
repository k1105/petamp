import { useEffect, useMemo } from 'react'
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers'
import { useMap, useMapZoom } from './MapContext'
import { DeckOverlay } from './DeckOverlay'
import { FIT_MAX_ZOOM } from './fitConstants'
import { useSettingsStore } from '../../store/useSettingsStore'
import { positionAtTime, relAltitudeAtTime } from '../../hooks/useGalleryAnimation'
import { buildPathPositions } from '../../utils/tubeMesh'
import { effectiveRadius } from '../../utils/effectiveRadius'
import { acceptedPoints } from '../../utils/recordingFilters'
import { hexToRgb, type Palette } from '../../utils/themePalettes'
import type { Run } from '../../types'

const MIN_ZOOM = 12.5

/**
 * 個別ラン (RunDetailPage) の軌跡 + 動点レイヤ。
 * mapVisible=false の単色表現では高度を z 軸に反映し、deck.gl を
 * 全画面 sibling として描く (.map-canvas の mask/inset による縁 fade 回避)。
 */
export function DetailLayers({
  run, currentTime, mapVisible, palette, pointCloud,
}: { run: Run; currentTime: number; mapVisible: boolean; palette: Palette; pointCloud: boolean }) {
  const zoom = useMapZoom()
  const { map } = useMap()
  const radii = useSettingsStore(s => s.radii)
  const altitudeScaleSetting = useSettingsStore(s => s.ui.altitudeScale)
  const accentRgb = useMemo<[number, number, number]>(
    () => hexToRgb(palette.accent),
    [palette.accent],
  )

  // 経路全体が画面中央に収まるようにフィット（bbox中心 = 画面中心）
  // run が切り替わったら再フィット
  useEffect(() => {
    if (!map) return
    const fitPts = acceptedPoints(run.trackPoints)
    if (fitPts.length === 0) return
    const lngs = fitPts.map(p => p.lng)
    const lats = fitPts.map(p => p.lat)
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ]
    map.fitBounds(bounds, { padding: 60, duration: 300, maxZoom: FIT_MAX_ZOOM })
  }, [map, run])

  // 単色表現 (mapVisible=false) の時だけ高度を z 軸に反映。マップ表示時は平面。
  const altitudeScale = mapVisible ? 0 : altitudeScaleSetting

  // 動点と tube で高度フィルタの入力配列を共有させるため pts を先に確定させる。
  // 同じ参照を relAltitudeAtTime と buildPathPositions の双方に渡し、WeakMap
  // キャッシュがヒットして同一のフィルタ結果が使われるようにする。
  const pts = useMemo(() => acceptedPoints(run.trackPoints), [run])

  const dotData = useMemo(() => {
    const pos = positionAtTime(run, currentTime)
    if (!pos) return []
    const z = altitudeScale > 0 ? relAltitudeAtTime(run, currentTime, pts) * altitudeScale : 0
    return [{ position: [pos[0], pos[1], z] as [number, number, number] }]
  }, [run, currentTime, altitudeScale, pts])


  const t = Math.max(0, Math.min(1, (zoom - (MIN_ZOOM - 0.5)) / 0.5))
  const tubeWidth = effectiveRadius(zoom, radii.zoomThreshold, radii.tubeRadius) * 2
  const dotRadius = effectiveRadius(zoom, radii.zoomThreshold, radii.dotRadius)
  // 点群表現の円半径。点を小さめにして、軌跡を粒の集まりとして見せる。
  const trailRadius = (tubeWidth / 2) * 1.6 * 0.3
  const pathPositions = useMemo(
    () => buildPathPositions(pts, altitudeScale),
    [pts, altitudeScale],
  )

  // マップ非表示時は白+黒、表示時はグレー+アクセント
  const tubeColor: [number, number, number, number] = mapVisible
    ? [160, 160, 160, Math.round(255 * t)]
    : [255, 255, 255, 255]
  const dotColor: [number, number, number, number] = mapVisible
    ? [...accentRgb, Math.round(255 * t)]
    : [255, 255, 255, 255]

  const layers = useMemo(() => {
    if (mapVisible && t === 0) return []
    if (pathPositions.length < 2) return []
    // 成分表示 (Nutrition) モードでは軌跡を線ではなく点群で描く。
    const trailLayer = pointCloud
      ? new ScatterplotLayer<[number, number, number]>({
          id: 'run-trail-points',
          data: pathPositions,
          getPosition: d => d,
          getRadius: trailRadius,
          radiusUnits: 'meters',
          getFillColor: tubeColor,
          billboard: true,
          // 半透明の重なりを綺麗に出すため深度書き込みを切る。
          parameters: { depthWriteEnabled: false },
          updateTriggers: { getFillColor: tubeColor, getRadius: trailRadius },
        })
      : new PathLayer({
          id: 'run-tube',
          data: [pathPositions],
          getPath: d => d,
          getColor: tubeColor,
          getWidth: tubeWidth,
          widthUnits: 'meters',
          capRounded: true,
          jointRounded: true,
          billboard: true,
          updateTriggers: { getColor: tubeColor },
        })
    const dotLayer = new ScatterplotLayer({
      id: 'run-dot',
      data: dotData,
      getPosition: (d: { position: [number, number, number] }) => d.position,
      getRadius: dotRadius,
      radiusUnits: 'meters',
      getFillColor: dotColor,
      billboard: true,
      updateTriggers: { getFillColor: dotColor },
    })
    return [trailLayer, dotLayer]
  }, [pathPositions, dotData, t, mapVisible, pointCloud, tubeWidth, trailRadius, dotRadius, tubeColor, dotColor])

  // 単色表現時は .map-canvas の mask/inset で path が縁で fade してしまうため、
  // deck.gl を sibling として全画面に出す。
  return <DeckOverlay layers={layers} mode={mapVisible ? 'mapbox' : 'fullscreen'} />
}
