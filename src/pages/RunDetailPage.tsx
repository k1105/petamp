import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { SphereGeometry } from '@luma.gl/engine'
import { Icon } from '@iconify/react'
import { EyesIcon } from '../components/gallery/EyesIcon'
import { BaseMap, useMap, useMapZoom } from '../components/map/BaseMap'
import { DeckOverlay } from '../components/map/DeckOverlay'
import { AreaLabel } from '../components/map/AreaLabel'
import { AnimationControl } from '../components/detail/AnimationControl'
import { PathDebugPanel } from '../components/recording/PathDebugPanel'
import { useAnimation } from '../hooks/useAnimation'
import { useElevationStats } from '../hooks/useElevationStats'
import { useActivePalette } from '../hooks/useActivePalette'
import { hexToRgb } from '../utils/themePalettes'
import { useRunStore } from '../store/useRunStore'
import { positionAtTime } from '../hooks/useGalleryAnimation'
import { getTubeMesh } from '../utils/tubeMesh'
import { effectiveRadius, bucketRadius } from '../utils/effectiveRadius'
import { acceptedPoints } from '../utils/recordingFilters'
import { useSettingsStore } from '../store/useSettingsStore'
import { fetchAreaName } from '../hooks/useReverseGeocode'
import { buildTripLayerData } from '../utils/tripLayerData'
import { totalDistance } from '../utils/geoUtils'
import { formatDistance, formatElevation, formatDate } from '../utils/formatters'
import { loadRun } from '../db/runRepository'
import { getMemoryStore, petampCharacter } from '../character'
import type { EpisodicMemory } from '../character'
import type { Run } from '../types'

const sphere = new SphereGeometry({ radius: 1, nlat: 20, nlong: 20 })
const MIN_ZOOM = 12.5
const FIT_MAX_ZOOM = 17

function DetailLayers({
  run, currentTime, mapVisible,
}: { run: Run; currentTime: number; mapVisible: boolean }) {
  const zoom = useMapZoom()
  const { map } = useMap()
  const radii = useSettingsStore(s => s.radii)
  const { palette } = useActivePalette()
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

  const dotData = useMemo(() => {
    const pos = positionAtTime(run, currentTime)
    return pos ? [{ position: pos }] : []
  }, [run, currentTime])


  const t = Math.max(0, Math.min(1, (zoom - (MIN_ZOOM - 0.5)) / 0.5))
  const pts = useMemo(() => acceptedPoints(run.trackPoints), [run])
  const tubeRadius = bucketRadius(
    effectiveRadius(zoom, radii.zoomThreshold, radii.tubeRadius),
  )
  const dotRadius = effectiveRadius(zoom, radii.zoomThreshold, radii.dotRadius)
  const tubeMesh = useMemo(() => getTubeMesh(run.id, pts, tubeRadius), [run.id, pts, tubeRadius])

  // マップ非表示時は白+黒、表示時はグレー+アクセント
  const tubeColor: [number, number, number, number] = mapVisible
    ? [160, 160, 160, Math.round(255 * t)]
    : [255, 255, 255, 255]
  const dotColor: [number, number, number, number] = mapVisible
    ? [...accentRgb, Math.round(255 * t)]
    : [255, 255, 255, 255]
  const mat = { ambient: 1, diffuse: 0, shininess: 0, specularColor: [0, 0, 0] as [number, number, number] }

  const layers = useMemo(() => {
    const tubeLayer = tubeMesh
      ? new SimpleMeshLayer({
          id: 'run-tube',
          data: [{ position: tubeMesh.anchor }],
          mesh: {
            attributes: {
              POSITION: { value: tubeMesh.positions, size: 3 },
              NORMAL: { value: tubeMesh.normals, size: 3 },
            },
            indices: { value: tubeMesh.indices, size: 1 },
          },
          getPosition: (d: { position: [number, number] }) => [d.position[0], d.position[1], 0] as [number, number, number],
          getColor: tubeColor,
          material: mat,
        })
      : null
    const dotLayer = new SimpleMeshLayer({
      id: 'run-dot',
      data: dotData,
      mesh: sphere,
      getPosition: (d: { position: [number, number] }) => [d.position[0], d.position[1], 0] as [number, number, number],
      getScale: [dotRadius, dotRadius, dotRadius],
      getColor: dotColor,
      material: mat,
    })
    if (!mapVisible) return tubeLayer ? [tubeLayer, dotLayer] : [dotLayer]
    if (t === 0) return []
    return tubeLayer ? [tubeLayer, dotLayer] : [dotLayer]
  }, [tubeMesh, dotData, t, mapVisible, dotRadius, accentRgb])

  return <DeckOverlay layers={layers} />
}

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [run, setRun] = useState<Run | null>(null)
  const [mapVisible, setMapVisible] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [memories, setMemories] = useState<EpisodicMemory[]>([])
  const [bubbleOpen, setBubbleOpen] = useState(false)
  const eyeRef = useRef<HTMLButtonElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
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

  // 終端到達 → 5秒待って先頭から再生
  useEffect(() => {
    if (isPlaying || duration <= 0 || currentTime < duration) return
    const id = window.setTimeout(() => {
      reset()
      play()
    }, 5000)
    return () => window.clearTimeout(id)
  }, [isPlaying, currentTime, duration, reset, play])
  const acceptedRunPoints = useMemo(() => acceptedPoints(run?.trackPoints ?? []), [run])
  const { gain } = useElevationStats(acceptedRunPoints)

  // バブルの位置を eyeRef から計算 (multi-line で高さが変わるので毎回測る)
  useEffect(() => {
    if (!bubbleOpen) return
    const place = () => {
      const eye = eyeRef.current
      const bubble = bubbleRef.current
      if (!eye || !bubble) return
      const r = eye.getBoundingClientRect()
      const cx = r.left + r.width / 2
      bubble.style.left = `${cx - bubble.offsetWidth + 18}px`
      bubble.style.top = `${r.top - 12 - bubble.offsetHeight}px`
    }
    place()
    const ro = new ResizeObserver(place)
    if (eyeRef.current) ro.observe(eyeRef.current)
    if (bubbleRef.current) ro.observe(bubbleRef.current)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [bubbleOpen, memories])

  // このRunに紐づく episodic memory を取得
  useEffect(() => {
    if (!run) return
    let cancelled = false
    void getMemoryStore()
      .queryEpisodic({
        characterId: petampCharacter.id,
        relatedTo: [{ kind: 'run', id: run.id }],
      })
      .then(eps => {
        if (!cancelled) setMemories(eps)
      })
    return () => {
      cancelled = true
    }
  }, [run])

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

  // BaseMapを初期マウント時から fit 後の zoom で立ち上げる。
  // initialZoom=14 → fitBounds 寄せの間に dot/tube が別サイズで描画される問題を回避。
  // BaseMap の useEffect は [] deps なので、後続のRun切替は既存fitBoundsで処理される。
  const initialBounds = useMemo(():
    | [[number, number], [number, number]]
    | undefined => {
    if (!run || acceptedRunPoints.length === 0) return undefined
    const lngs = acceptedRunPoints.map(p => p.lng)
    const lats = acceptedRunPoints.map(p => p.lat)
    return [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ]
  }, [run, acceptedRunPoints])

  if (!run) return <div className="page loading">読み込み中...</div>

  const dist = totalDistance(acceptedRunPoints)
  const currentIdx = runs.findIndex(r => r.id === run.id)
  const prevRun = currentIdx > 0 ? runs[currentIdx - 1] : null
  const nextRun = currentIdx >= 0 && currentIdx < runs.length - 1 ? runs[currentIdx + 1] : null

  return (
    <div className="page" style={!mapVisible ? { background: 'var(--accent)' } : undefined}>
      <div className="map-container">
        <BaseMap
          initialCenter={center}
          initialZoom={14}
          initialBounds={initialBounds}
          initialBoundsPadding={60}
          initialBoundsMaxZoom={FIT_MAX_ZOOM}
          lockTarget
          mapVisible={mapVisible}
        >
          <DetailLayers run={run} currentTime={currentTime} mapVisible={mapVisible} />
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

      <div className="run-detail-meta">
        <div className="run-detail-meta-name">{run.name}</div>
        <div className="run-detail-meta-date">{formatDate(run.startedAt)}</div>
        <div className="run-detail-meta-stat">
          <span className="run-detail-meta-stat-label">距離</span>
          <span className="run-detail-meta-stat-value">{formatDistance(dist)}</span>
        </div>
        <div className="run-detail-meta-stat">
          <span className="run-detail-meta-stat-label">獲得標高</span>
          <span className="run-detail-meta-stat-value">↑{formatElevation(gain)}</span>
        </div>
      </div>

      <div className="run-detail-control">
        <AnimationControl
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          onPlay={play}
          onStop={stop}
          onSeek={seekTo}
        />
      </div>

      {debugOpen && (
        <PathDebugPanel
          trackPoints={run.trackPoints}
          areaName={run.areaName}
          onCancel={() => setDebugOpen(false)}
        />
      )}

      {/* Persistent eye carried over from the gallery → run-detail transition.
          Tapping pops a bubble; the bubble's inline link enters the chat. */}
      <button
        ref={eyeRef}
        type="button"
        className="run-detail-eye"
        onClick={() => setBubbleOpen(v => !v)}
        aria-label="ペタンプの吹き出しを開く"
      >
        <EyesIcon />
      </button>

      {bubbleOpen && (
        <>
          <div className="run-detail-bubble-backdrop" onClick={() => setBubbleOpen(false)} />
          <div ref={bubbleRef} className="run-detail-bubble">
            {memories.length > 0 ? (
              <>
                <p className="run-detail-bubble-text">{memories[0].summary}</p>
                <button
                  type="button"
                  className="run-detail-bubble-link"
                  onClick={() => navigate(`/run/${run.id}/chat`)}
                >
                  もっと話す →
                </button>
              </>
            ) : (
              <>
                <p className="run-detail-bubble-text">このランについて、もっと教えて!</p>
                <button
                  type="button"
                  className="run-detail-bubble-link"
                  onClick={() => navigate(`/run/${run.id}/chat`)}
                >
                  話す →
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
