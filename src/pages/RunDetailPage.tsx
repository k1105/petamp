import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { PathLayer } from '@deck.gl/layers'
import { ScatterplotLayer, IconLayer } from '@deck.gl/layers'
import { Icon } from '@iconify/react'
import { EyesIcon } from '../components/gallery/EyesIcon'
import { BaseMap } from '../components/map/BaseMap'
import { useMap, useMapZoom } from '../components/map/MapContext'
import { DeckOverlay } from '../components/map/DeckOverlay'
import { AreaLabel } from '../components/map/AreaLabel'
import { PathDebugPanel } from '../components/recording/PathDebugPanel'
import { useAnimation } from '../hooks/useAnimation'
import { useElevationStats } from '../hooks/useElevationStats'
import { getPaletteForRun, hexToRgb, type Palette } from '../utils/themePalettes'
import { useRunStore } from '../store/useRunStore'
import { useMapStore } from '../store/useMapStore'
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
import { computeRunsBbox, expandBboxByMeters } from '../utils/runBbox'
import { loadCircularAvatar } from '../utils/circularAvatar'
import { useCoRunReplay, type CoRunEntry } from '../hooks/useCoRunReplay'
import { useCoRunStore } from '../store/useCoRunStore'
import { usePostRunLoadingStore } from '../store/usePostRunLoadingStore'
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

const AVATAR_DOT_SCALE = 1.2

// 一緒に走ったメンバー全員の軌跡を色分けで重ね、共通の絶対タイムラインで N 本の
// ポリライン + 動点を同時再生する。動点には各メンバーの Google アイコン (円形) を出す。
// 旧 CoRunResultPage の描画をここに統合し、専用画面を廃止した。
function CoRunDetailLayers({
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

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  // ラン終了直後の co-run ライブフロー (RecordingPage から遷移) かどうか。
  const coRunLive = !!(location.state as { coRunLive?: boolean } | null)?.coRunLive
  const liveMyRunId = (location.state as { myRunId?: string } | null)?.myRunId ?? null
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
  // 画面中央タップ時に一瞬出す再生/停止アイコン。n はアニメーション再生用の更新キー。
  const [tapFlash, setTapFlash] = useState<{ icon: 'play' | 'pause'; n: number } | null>(null)
  const tapFlashNRef = useRef(0)
  const tapFlashTimerRef = useRef<number | null>(null)
  const notationEnabled = useSettingsStore(s => s.experimental.notation)

  // 直リンクでrunsが空のままならロード（next/prev算出 + 404判定用）
  useEffect(() => {
    if (runs.length > 0) {
      // store にロード済みなら明示的に loaded=true へ。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRunsLoaded(true)
      return
    }
    loadRuns().finally(() => setRunsLoaded(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const { currentTime, duration, setDuration, play, stop, reset } = useAnimation()

  // ループは useAnimation 側で末尾→先頭に巻き戻して継続するので、ここでの再開処理は不要。

  // ページ表示時は再生をデフォルトにする (run ロード & duration 確定で自動再生)
  useEffect(() => {
    if (duration <= 0) return
    play()
    return () => stop()
  }, [run?.id, duration, play, stop])

  // 画面中央に再生/停止アイコンを一瞬表示する
  const showTapFlash = useCallback((icon: 'play' | 'pause') => {
    tapFlashNRef.current += 1
    setTapFlash({ icon, n: tapFlashNRef.current })
    if (tapFlashTimerRef.current !== null) window.clearTimeout(tapFlashTimerRef.current)
    tapFlashTimerRef.current = window.setTimeout(() => setTapFlash(null), 600)
  }, [])

  // 再生/停止トグル。最新状態は store から直接読む（毎フレームの再subscribeを避ける）
  const togglePlayback = useCallback(() => {
    const s = useMapStore.getState()
    if (s.isPlaying) {
      stop()
      showTapFlash('pause')
    } else {
      if (s.duration > 0 && s.currentTime >= s.duration) reset()
      play()
      showTapFlash('play')
    }
  }, [play, stop, reset, showTapFlash])

  // 画面中央タップで再生/停止を切り替える。ドラッグ(地図オービット)や長押し、
  // ボタン類・吹き出し・デバッグパネル上のタップはトグル対象外。
  useEffect(() => {
    let start: { x: number; y: number; t: number } | null = null
    const onDown = (e: PointerEvent) => {
      start = { x: e.clientX, y: e.clientY, t: e.timeStamp }
    }
    const onUp = (e: PointerEvent) => {
      const s = start
      start = null
      if (!s) return
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) return
      if (e.timeStamp - s.t > 500) return
      const el = e.target as HTMLElement | null
      if (el?.closest('button, a, input, .run-detail-meta, .run-detail-bubble, .run-detail-bubble-backdrop, .debug-overlay')) return
      togglePlayback()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('pointerup', onUp)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('pointerup', onUp)
    }
  }, [togglePlayback])

  // アンマウント時に flash タイマーを後始末
  useEffect(() => () => {
    if (tapFlashTimerRef.current !== null) window.clearTimeout(tapFlashTimerRef.current)
  }, [])

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

  // ── co-run (一緒に走ったラン) ──────────────────────────────────────────
  // 同一 coRunSessionId のラン (自分 + 相手) を集め、N 本の軌跡 + 各自の Google
  // アイコン付き動点を共通タイムラインで再生する。専用画面 (旧 CoRunResultPage) は
  // 廃止し、この個別ラン画面に統合した。
  const coRunSessionId = run?.coRunSessionId ?? null
  // 自分のランを 1 本に畳む際の優先 runId: ライブは遷移元の myRunId、一覧からは
  // 表示中のラン (自分のものなら)。
  const foldRunId = liveMyRunId ?? (run && !isOthers ? run.id : null)
  const coRunEntries = useCoRunReplay(coRunSessionId, { live: coRunLive, myRunId: foldRunId })
  const isCoRun = !!coRunSessionId && !!coRunEntries && coRunEntries.length > 0

  // 全員の絶対時刻を貫く共通タイムライン (秒)。
  const coRunTimeline = useMemo(() => {
    if (!coRunEntries || coRunEntries.length === 0) return null
    const start = Math.min(...coRunEntries.map(e => e.run.startedAt))
    const end = Math.max(...coRunEntries.map(e => e.run.finishedAt))
    return { start, durationSec: Math.max(1, (end - start) / 1000) }
  }, [coRunEntries])

  // 動点用に各メンバーの Google アイコンを円形クロップして読み込む。
  const [coRunAvatars, setCoRunAvatars] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    if (!coRunEntries) return
    // キャッシュ済み URL も loadCircularAvatar は即返すので、ここで除外しない。
    // (除外すると先に IslandView 等でキャッシュされた分が state に入らずアイコンが出ない)
    const urls = coRunEntries.map(e => e.photoURL).filter((u): u is string => !!u)
    if (urls.length === 0) return
    let cancelled = false
    void Promise.all(urls.map(u => loadCircularAvatar(u).then(d => [u, d] as const))).then(
      pairs => {
        if (cancelled) return
        setCoRunAvatars(prev => {
          const next = new Map(prev)
          let changed = false
          for (const [u, d] of pairs) {
            if (d && next.get(u) !== d) {
              next.set(u, d)
              changed = true
            }
          }
          return changed ? next : prev
        })
      },
    )
    return () => {
      cancelled = true
    }
  }, [coRunEntries])

  // co-run の場合は共通タイムラインの長さに duration を合わせる (単色再生ループ用)。
  useEffect(() => {
    if (!isCoRun || !coRunTimeline) return
    setDuration(coRunTimeline.durationSec)
  }, [isCoRun, coRunTimeline, setDuration])

  // ライブ co-run フローの「次へ」: セッションを片付けてから自分のランの対話へ進む。
  const proceedFromCoRun = useCallback(() => {
    stop()
    useCoRunStore.getState().clearLocal()
    const targetRunId = liveMyRunId ?? run?.id
    if (targetRunId) {
      usePostRunLoadingStore
        .getState()
        .start({ x: window.innerWidth / 2, y: window.innerHeight - 80 })
      navigate(`/run/${targetRunId}/result`)
    } else {
      navigate('/')
    }
  }, [stop, liveMyRunId, run, navigate])

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
      // store にあれば追加 IO 無しで即セット。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRun(inMemory)
      setDuration(buildTripLayerData(inMemory).duration)
      reset()
      return
    }
    // 自分のランに見つからなければフォロー中ユーザーのランも探す (read-only)。
    const fromFollowed = followedRuns.find(r => r.id === id)
    if (fromFollowed) {
      // social feed キャッシュにあればこちらも同期セット。
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // co-run 再生用の絶対時刻 (共通タイムラインの start + 経過秒)。
  const coRunAbsMs = coRunTimeline ? coRunTimeline.start + currentTime * 1000 : 0

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
          {isCoRun && coRunEntries ? (
            <CoRunDetailLayers
              entries={coRunEntries}
              absMs={coRunAbsMs}
              mapVisible={mapVisible}
              avatars={coRunAvatars}
            />
          ) : (
            <DetailLayers run={run} currentTime={currentTime} mapVisible={mapVisible} palette={runPalette} />
          )}
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

      {/* ライブ co-run フロー中は前後ランナビではなく「次へ」(対話へ進む) を出す。 */}
      {!coRunLive && (
        <>
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
        </>
      )}

      {coRunLive && (
        <div className="co-run-result-controls">
          <button type="button" className="co-run-btn co-run-btn-primary" onClick={proceedFromCoRun}>
            次へ
          </button>
        </div>
      )}

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

      {tapFlash && (
        <div className="run-detail-tap-flash" key={tapFlash.n}>
          <Icon icon={tapFlash.icon === 'play' ? 'lucide:play' : 'lucide:pause'} />
        </div>
      )}

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
