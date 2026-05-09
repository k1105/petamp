import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { SphereGeometry, CylinderGeometry } from '@luma.gl/engine'
import mapboxgl from 'mapbox-gl'
import { Icon } from '@iconify/react'
import { BaseMap, useMap, useMapZoom } from '../components/map/BaseMap'
import { DeckOverlay } from '../components/map/DeckOverlay'
import { AreaLabel } from '../components/map/AreaLabel'
import { AnimationControl } from '../components/detail/AnimationControl'
import { PathDebugPanel } from '../components/recording/PathDebugPanel'
import { useAnimation } from '../hooks/useAnimation'
import { useElevationStats } from '../hooks/useElevationStats'
import { useRunStore } from '../store/useRunStore'
import { positionAtTime } from '../hooks/useGalleryAnimation'
import { buildTubeSegments, buildTubeJoints } from '../utils/tubeData'
import { acceptedPoints } from '../utils/recordingFilters'
import { useSettingsStore } from '../store/useSettingsStore'
import { fetchAreaName } from '../hooks/useReverseGeocode'
import { buildTripLayerData } from '../utils/tripLayerData'
import { totalDistance } from '../utils/geoUtils'
import { formatDistance, formatElevation, formatDate } from '../utils/formatters'
import { loadRun } from '../db/runRepository'
import type { Run } from '../types'

const sphere = new SphereGeometry({ radius: 1, nlat: 20, nlong: 20 })
const cylinder = new CylinderGeometry({ radius: 1, height: 1, nradial: 12 })
const MIN_ZOOM = 12.5
const FIT_MAX_ZOOM = 17

function DetailLayers({
  run, currentTime, isPlaying, mapVisible,
}: { run: Run; currentTime: number; isPlaying: boolean; mapVisible: boolean }) {
  const zoom = useMapZoom()
  const { map } = useMap()
  const radii = useSettingsStore(s => s.radii)

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

  const dotData = useMemo(() => {
    const pos = positionAtTime(run, currentTime)
    return pos ? [{ position: pos }] : []
  }, [run, currentTime])

  // 再生中は動点にカメラ追従（transform直接更新でzoom animationを妨げない）
  useEffect(() => {
    if (!map || !isPlaying) return
    const pos = positionAtTime(run, currentTime)
    if (!pos) return
    const m = map as unknown as { transform: { center: unknown }; triggerRepaint: () => void }
    m.transform.center = (mapboxgl.LngLat as unknown as { convert: (v: [number, number]) => unknown }).convert(pos)
    m.triggerRepaint()
  }, [map, currentTime, isPlaying])

  const t = Math.max(0, Math.min(1, (zoom - (MIN_ZOOM - 0.5)) / 0.5))
  const pts = useMemo(() => acceptedPoints(run.trackPoints), [run])
  const tubeData = useMemo(() => buildTubeSegments(pts, radii.tubeRadius), [pts, radii.tubeRadius])
  const jointData = useMemo(() => buildTubeJoints(pts, radii.tubeRadius), [pts, radii.tubeRadius])

  // マップ非表示時は白+黒、表示時はグレー+グリーン
  const tubeColor: [number, number, number, number] = mapVisible
    ? [160, 160, 160, Math.round(255 * t)]
    : [255, 255, 255, 255]
  const dotColor: [number, number, number, number] = mapVisible
    ? [28, 151, 94, Math.round(255 * t)]
    : [255, 255, 255, 255]
  const mat = { ambient: 1, diffuse: 0, shininess: 0, specularColor: [0, 0, 0] as [number, number, number] }

  const layers = useMemo(() => {
    if (!mapVisible) {
      return [
        new SimpleMeshLayer({
          id: 'run-tube',
          data: tubeData,
          mesh: cylinder,
          getPosition: d => d.position,
          getScale: d => d.scale,
          getOrientation: d => d.orientation,
          getColor: tubeColor,
          material: mat,
        }),
        new SimpleMeshLayer({
          id: 'run-joints',
          data: jointData,
          mesh: sphere,
          getPosition: d => d.position,
          getScale: d => d.scale,
          getColor: tubeColor,
          material: mat,
        }),
        new SimpleMeshLayer({
          id: 'run-dot',
          data: dotData,
          mesh: sphere,
          getPosition: (d: { position: [number, number] }) => [d.position[0], d.position[1], 0] as [number, number, number],
          getScale: [radii.dotRadius, radii.dotRadius, radii.dotRadius],
          getColor: dotColor,
          material: mat,
        }),
      ]
    }
    if (t === 0) return []
    return [
      new SimpleMeshLayer({
        id: 'run-tube',
        data: tubeData,
        mesh: cylinder,
        getPosition: d => d.position,
        getScale: d => d.scale,
        getOrientation: d => d.orientation,
        getColor: tubeColor,
        material: mat,
      }),
      new SimpleMeshLayer({
        id: 'run-joints',
        data: jointData,
        mesh: sphere,
        getPosition: d => d.position,
        getScale: d => d.scale,
        getColor: tubeColor,
        material: mat,
      }),
      new SimpleMeshLayer({
        id: 'run-dot',
        data: dotData,
        mesh: sphere,
        getPosition: (d: { position: [number, number] }) => [d.position[0], d.position[1], 0] as [number, number, number],
        getScale: [radii.dotRadius, radii.dotRadius, radii.dotRadius],
        getColor: dotColor,
        material: mat,
      }),
    ]
  }, [tubeData, jointData, dotData, t, mapVisible, radii.dotRadius])

  return <DeckOverlay layers={layers} />
}

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [run, setRun] = useState<Run | null>(null)
  const [mapVisible, setMapVisible] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const { runs, loadRuns, updateRun } = useRunStore()
  const [runsLoaded, setRunsLoaded] = useState(false)

  // 直リンクでrunsが空のままならロード（next/prev算出 + 404判定用）
  useEffect(() => {
    if (runs.length > 0) {
      setRunsLoaded(true)
      return
    }
    loadRuns().finally(() => setRunsLoaded(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const { currentTime, isPlaying, duration, setDuration, play, stop, seekTo, reset } = useAnimation()
  const acceptedRunPoints = useMemo(() => acceptedPoints(run?.trackPoints ?? []), [run])
  const { gain } = useElevationStats(acceptedRunPoints)

  // 過去のラン (areaName未保存) を初回表示時にバックフィル
  useEffect(() => {
    if (!run || run.areaName) return
    const lats = run.trackPoints.map(p => p.lat)
    const lngs = run.trackPoints.map(p => p.lng)
    if (lats.length === 0) return
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2
    fetchAreaName(centerLng, centerLat).then(name => {
      if (!name) return
      updateRun(run.id, { areaName: name }).then(updated => {
        if (updated) setRun(updated)
      })
    })
  }, [run?.id])

  useEffect(() => {
    if (!id) return
    const inMemory = runs.find(r => r.id === id)
    if (inMemory) {
      setRun(inMemory)
      setDuration(buildTripLayerData(inMemory).duration)
      reset()
      return
    }
    // runs ロード完了前に loadRun→redirect を走らせると、たまたま読み込み待ち
    // 中の有効なIDで誤って "/" へ飛ぶ。runs 確定後に判定する。
    if (!runsLoaded) return
    loadRun(id).then(r => {
      if (!r) {
        navigate('/', { replace: true })
        return
      }
      setRun(r)
      setDuration(buildTripLayerData(r).duration)
      reset()
    })
  }, [id, runs, runsLoaded])

  const center = useMemo((): [number, number] | undefined => {
    if (!run || acceptedRunPoints.length === 0) return undefined
    const mid = acceptedRunPoints[Math.floor(acceptedRunPoints.length / 2)]
    return [mid.lng, mid.lat]
  }, [run, acceptedRunPoints])

  if (!run) return <div className="page loading">読み込み中...</div>

  const dist = totalDistance(acceptedRunPoints)
  const currentIdx = runs.findIndex(r => r.id === run.id)
  const prevRun = currentIdx > 0 ? runs[currentIdx - 1] : null
  const nextRun = currentIdx >= 0 && currentIdx < runs.length - 1 ? runs[currentIdx + 1] : null

  return (
    <div className="page" style={!mapVisible ? { background: 'var(--accent)' } : undefined}>
      <div className="map-container">
        <BaseMap initialCenter={center} initialZoom={14} lockTarget mapVisible={mapVisible}>
          <DetailLayers run={run} currentTime={currentTime} isPlaying={isPlaying} mapVisible={mapVisible} />
          <AreaLabel override={run.areaName} />
        </BaseMap>
      </div>

      <button className="back-btn" onClick={() => navigate('/')} aria-label="戻る">
        <Icon icon="lucide:arrow-left" />
      </button>
      <button
        className={`map-toggle-btn ${!mapVisible ? 'active' : ''}`}
        onClick={() => setMapVisible(v => !v)}
        title={mapVisible ? 'マップ非表示' : 'マップ表示'}
        aria-label={mapVisible ? 'マップ非表示' : 'マップ表示'}
      >
        <Icon icon={mapVisible ? 'lucide:map-off' : 'lucide:map'} />
      </button>
      <button
        className="debug-btn"
        onClick={() => setDebugOpen(true)}
        title="パスデータを表示"
        aria-label="パスデータを表示"
      >
        <Icon icon="lucide:braces" />
      </button>

      <button
        className="run-nav-btn run-nav-prev"
        onClick={() => prevRun && navigate(`/run/${prevRun.id}`)}
        disabled={!prevRun}
        aria-label="前のラン"
        title="前のラン"
      >
        <Icon icon="lucide:chevron-left" />
      </button>
      <button
        className="run-nav-btn run-nav-next"
        onClick={() => nextRun && navigate(`/run/${nextRun.id}`)}
        disabled={!nextRun}
        aria-label="次のラン"
        title="次のラン"
      >
        <Icon icon="lucide:chevron-right" />
      </button>

      <div className="bottom-bar">
        <div className="run-meta">
          <span className="run-meta-name">{run.name}</span>
          <span className="run-meta-date">{formatDate(run.startedAt)}</span>
        </div>
        <div className="detail-stats">
          <div className="stat">
            <span className="stat-value">{formatDistance(dist)}</span>
            <span className="stat-label">距離</span>
          </div>
          <div className="stat">
            <span className="stat-value">↑{formatElevation(gain)}</span>
            <span className="stat-label">獲得標高</span>
          </div>
        </div>
        <AnimationControl
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          onPlay={play}
          onStop={stop}
          onSeek={seekTo}
          onReset={reset}
        />
      </div>

      {debugOpen && (
        <PathDebugPanel
          trackPoints={run.trackPoints}
          areaName={run.areaName}
          onCancel={() => setDebugOpen(false)}
        />
      )}
    </div>
  )
}
