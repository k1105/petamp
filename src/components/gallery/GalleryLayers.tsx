import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers'
import { useMap, useMapZoom } from '../map/MapContext'
import { DeckOverlay } from '../map/DeckOverlay'
import { NP_ALL_LAYERS } from '../map/namedPlaceLayerIds'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useActivePalette } from '../../hooks/useActivePalette'
import { buildPathPositions } from '../../utils/tubeMesh'
import { effectiveRadius } from '../../utils/effectiveRadius'
import { acceptedPoints } from '../../utils/recordingFilters'
import { hexToRgb } from '../../utils/themePalettes'
import type { DotPosition } from '../../hooks/useGalleryAnimation'
import type { Run } from '../../types'

const MIN_ZOOM = 12.5

export function GalleryLayers({
  runs,
  dots,
}: {
  runs: Run[]
  dots: DotPosition[]
}) {
  const { map } = useMap()
  const zoom = useMapZoom()
  const navigate = useNavigate()
  const radii = useSettingsStore(s => s.radii)
  const { palette } = useActivePalette()

  const t = Math.max(0, Math.min(1, (zoom - (MIN_ZOOM - 0.5)) / 0.5))
  const accentRgb = useMemo<[number, number, number]>(
    () => hexToRgb(palette.accent),
    [palette.accent],
  )
  const tubeColor: [number, number, number, number] = [...accentRgb, Math.round(128 * t)]
  const dotColor: [number, number, number, number] = [...accentRgb, Math.round(255 * t)]
  // 点群表現の円は重なりで色が乗算的に濃くなるので、線より低い α にする。
  const trailColor: [number, number, number, number] = [...accentRgb, Math.round(70 * t)]

  const trailStyle = useSettingsStore(s => s.ui.galleryTrailStyle)

  const dotRadius = effectiveRadius(zoom, radii.zoomThreshold, radii.dotRadius)
  const tubeWidth = effectiveRadius(zoom, radii.zoomThreshold, radii.tubeRadius) * 2
  // 点群の円半径。線の半分幅 (tubeWidth/2) より少し大きくして点同士を重ね、
  // 軌跡が滑らかな帯に見えるようにする。
  const trailRadius = (tubeWidth / 2) * 1.6

  const runPaths = useMemo(
    () =>
      runs
        .map(run => ({
          id: run.id,
          path: buildPathPositions(acceptedPoints(run.trackPoints)),
        }))
        .filter(r => r.path.length >= 2),
    [runs],
  )

  // 点群表現用。各ランの全トラックポイントを { id, position } の平坦な配列にする。
  const trailPoints = useMemo(
    () =>
      runs.flatMap(run =>
        acceptedPoints(run.trackPoints).map(p => ({
          id: run.id,
          position: [p.lng, p.lat] as [number, number],
        })),
      ),
    [runs],
  )

  const layers = useMemo(() => {
    if (t === 0) return []
    // 同じ地点に地名 (mapbox レイヤ) がある場合は、地名 popup を優先して
    // ラン遷移しない (deck レイヤと mapbox 地名が両方 click 発火するため)。
    const onTrailClick = (info: { object?: { id: string }; x?: number; y?: number }) => {
      if (!info.object) return
      if (map && info.x != null && info.y != null) {
        try {
          const present = NP_ALL_LAYERS.filter(id => map.getLayer(id))
          if (present.length && map.queryRenderedFeatures([info.x, info.y], { layers: present }).length) {
            return
          }
        } catch {
          // クエリ失敗時はそのまま遷移にフォールバック。
        }
      }
      navigate(`/run/${info.object.id}`)
    }
    const trailLayer =
      trailStyle === 'points'
        ? new ScatterplotLayer<{ id: string; position: [number, number] }>({
            id: 'gallery-trail-points',
            data: trailPoints,
            getPosition: d => [d.position[0], d.position[1], 0],
            getRadius: trailRadius,
            radiusUnits: 'meters',
            getFillColor: trailColor,
            billboard: true,
            pickable: true,
            // 半透明の重なりを綺麗に出すため深度書き込みを切る。
            parameters: { depthWriteEnabled: false },
            onClick: onTrailClick,
            updateTriggers: { getFillColor: trailColor, getRadius: trailRadius },
          })
        : new PathLayer<{ id: string; path: [number, number, number][] }>({
            id: 'gallery-tubes',
            data: runPaths,
            getPath: d => d.path,
            getColor: tubeColor,
            getWidth: tubeWidth,
            widthUnits: 'meters',
            capRounded: true,
            jointRounded: true,
            billboard: true,
            pickable: true,
            onClick: onTrailClick,
            updateTriggers: { getColor: tubeColor },
          })
    const dotsLayer = new ScatterplotLayer({
      id: 'gallery-dots',
      data: dots,
      getPosition: (d: { position: [number, number] }) => [d.position[0], d.position[1], 0],
      getRadius: dotRadius,
      radiusUnits: 'meters',
      getFillColor: dotColor,
      billboard: true,
      // 動点はオクルージョンを無効化し、必ずチューブ(線)の最前面に描く。
      // 深度テストを always にして点が線に埋もれないようにする。
      parameters: { depthCompare: 'always', depthWriteEnabled: false },
      updateTriggers: { getFillColor: dotColor },
    })
    return [trailLayer, dotsLayer]
  }, [
    runPaths,
    trailPoints,
    trailStyle,
    trailColor,
    trailRadius,
    dots,
    t,
    dotRadius,
    tubeWidth,
    tubeColor,
    dotColor,
    navigate,
    map,
  ])

  return <DeckOverlay layers={layers} />
}
