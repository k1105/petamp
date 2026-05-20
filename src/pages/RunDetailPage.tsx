import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { PathLayer } from '@deck.gl/layers'
import { ScatterplotLayer } from '@deck.gl/layers'
import { Icon } from '@iconify/react'
import { EyesIcon } from '../components/gallery/EyesIcon'
import { BaseMap, useMap, useMapZoom } from '../components/map/BaseMap'
import { DeckOverlay } from '../components/map/DeckOverlay'
import { AreaLabel } from '../components/map/AreaLabel'
import { AnimationControl } from '../components/detail/AnimationControl'
import { PathDebugPanel } from '../components/recording/PathDebugPanel'
import { useAnimation } from '../hooks/useAnimation'
import { useElevationStats } from '../hooks/useElevationStats'
import { getPaletteForRun, hexToRgb, type Palette } from '../utils/themePalettes'
import { useRunStore } from '../store/useRunStore'
import { useSocialFeedStore } from '../store/useSocialFeedStore'
import { useAuth } from '../hooks/useAuth'
import { positionAtTime, relAltitudeAtTime } from '../hooks/useGalleryAnimation'
import { buildPathPositions } from '../utils/tubeMesh'
import { effectiveRadius } from '../utils/effectiveRadius'
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

const MIN_ZOOM = 12.5
const FIT_MAX_ZOOM = 17

function DetailLayers({
  run, currentTime, mapVisible, palette,
}: { run: Run; currentTime: number; mapVisible: boolean; palette: Palette }) {
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
    const tubeLayer = new PathLayer({
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
    return [tubeLayer, dotLayer]
  }, [pathPositions, dotData, t, mapVisible, tubeWidth, dotRadius, tubeColor, dotColor])

  // 単色表現時は .map-canvas の mask/inset で path が縁で fade してしまうため、
  // deck.gl を sibling として全画面に出す。
  return <DeckOverlay layers={layers} mode={mapVisible ? 'mapbox' : 'fullscreen'} />
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
  const followedRuns = useSocialFeedStore(s => s.followedRuns)
  const followedUsers = useSocialFeedStore(s => s.followedUsers)
  const { user: currentUser } = useAuth()
  const [runsLoaded, setRunsLoaded] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const notationEnabled = useSettingsStore(s => s.experimental.notation)

  // 画面タッチ中はシークバーを表示し、一定時間操作がなければフェードアウトする
  useEffect(() => {
    const HIDE_DELAY_MS = 2500
    let timerId: number | null = null
    const showThenScheduleHide = () => {
      setControlsVisible(true)
      if (timerId !== null) window.clearTimeout(timerId)
      timerId = window.setTimeout(() => {
        setControlsVisible(false)
        timerId = null
      }, HIDE_DELAY_MS)
    }
    document.addEventListener('pointerdown', showThenScheduleHide)
    document.addEventListener('pointermove', showThenScheduleHide)
    showThenScheduleHide()
    return () => {
      document.removeEventListener('pointerdown', showThenScheduleHide)
      document.removeEventListener('pointermove', showThenScheduleHide)
      if (timerId !== null) window.clearTimeout(timerId)
    }
  }, [])

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

  // 他人のランかどうか。ownerUid が現在ユーザー以外、または currentUser 不在 + ownerUid あり。
  const isOthers = useMemo(() => {
    if (!run?.ownerUid) return false
    return !currentUser || run.ownerUid !== currentUser.uid
  }, [run, currentUser])
  const ownerUser = useMemo(
    () => (run?.ownerUid ? followedUsers.find(u => u.uid === run.ownerUid) ?? null : null),
    [run, followedUsers],
  )

  // このRunに紐づく episodic memory を取得 (自分のランのみ)。他人のランでは
  // 取得しない。前回 own ラン分の state が残るが、UI 側で isOthers 時に
  // memories を参照しないので問題ない。
  useEffect(() => {
    if (!run || isOthers) return
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
  }, [run, isOthers])

  // 過去のラン (areaName未保存) を初回表示時にバックフィル (自分のランのみ)
  useEffect(() => {
    if (!run || run.areaName || isOthers) return
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
  }, [run?.id, isOthers])

  useEffect(() => {
    if (!id) return
    const inMemory = runs.find(r => r.id === id)
    if (inMemory) {
      setRun(inMemory)
      setDuration(buildTripLayerData(inMemory).duration)
      reset()
      return
    }
    // 自分のランに見つからなければフォロー中ユーザーのランも探す (read-only)。
    const fromFollowed = followedRuns.find(r => r.id === id)
    if (fromFollowed) {
      setRun(fromFollowed)
      setDuration(buildTripLayerData(fromFollowed).duration)
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
  }, [id, runs, followedRuns, runsLoaded])

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

  const runPalette = getPaletteForRun(run)
  const pageStyle = {
    background: !mapVisible ? runPalette.accent : undefined,
    '--accent': runPalette.accent,
    '--bg': runPalette.bg,
  } as React.CSSProperties

  return (
    <div className="page run-detail-page" style={pageStyle}>
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
          <DetailLayers run={run} currentTime={currentTime} mapVisible={mapVisible} palette={runPalette} />
          <AreaLabel override={run.areaName} />
        </BaseMap>
      </div>

      <button className="back-btn" onClick={() => navigate('/')} aria-label="閉じる">
        <Icon icon="lucide:x" />
      </button>
      <button
        className={`map-toggle-btn ${!mapVisible ? 'active' : ''}`}
        onClick={() => setMapVisible(v => !v)}
        title={mapVisible ? 'マップ非表示' : 'マップ表示'}
        aria-label={mapVisible ? 'マップ非表示' : 'マップ表示'}
      >
        <Icon icon={mapVisible ? 'lucide:map-pin-off' : 'lucide:map'} />
      </button>
      {!isOthers && (
        <button
          className="debug-btn"
          onClick={() => setDebugOpen(true)}
          title="パスデータを表示"
          aria-label="パスデータを表示"
        >
          <Icon icon="lucide:braces" />
        </button>
      )}

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

      <div className={`run-detail-control${controlsVisible ? '' : ' is-hidden'}`}>
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
          run={run}
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
            {isOthers ? (
              <p className="run-detail-bubble-text">
                {ownerUser?.displayName ? `${ownerUser.displayName} のラン` : '他のユーザーのラン'}
              </p>
            ) : memories.length > 0 ? (
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
            {!isOthers && notationEnabled && (
              <button
                type="button"
                className="run-detail-bubble-link"
                onClick={() => navigate(`/run/${run.id}/notation`)}
              >
                ぼくのことばで見る →
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
