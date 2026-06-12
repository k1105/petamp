import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { EyesIcon } from '../components/gallery/EyesIcon'
import { BaseMap } from '../components/map/BaseMap'
import { DetailLayers } from '../components/map/DetailLayers'
import { CoRunDetailLayers } from '../components/map/CoRunDetailLayers'
import { FIT_MAX_ZOOM } from '../components/map/fitConstants'
import { PathDebugPanel } from '../components/recording/PathDebugPanel'
import { NutritionFacts } from '../components/gallery/NutritionFacts'
import { useAnimation } from '../hooks/useAnimation'
import { useElevationStats } from '../hooks/useElevationStats'
import { useAuth } from '../hooks/useAuth'
import { useCoRunReplay } from '../hooks/useCoRunReplay'
import { useCoRunAvatars } from '../hooks/useCoRunAvatars'
import { useReplayTapToggle } from '../hooks/useReplayTapToggle'
import { useRunBubblePositioning } from '../hooks/useRunBubblePositioning'
import { useRunMetadata } from '../hooks/useRunMetadata'
import { useRunStore } from '../store/useRunStore'
import { useSocialFeedStore } from '../store/useSocialFeedStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useCoRunStore } from '../store/useCoRunStore'
import { usePostRunLoadingStore } from '../store/usePostRunLoadingStore'
import { getPaletteForRun } from '../utils/ui/themePalettes'
import { acceptedPoints } from '../utils/geo/recordingFilters'
import { buildTripLayerData } from '../utils/path/tripLayerData'
import { totalDistance } from '../utils/geo/geoUtils'
import { formatDistance, formatElevation, formatDate } from '../utils/ui/formatters'
import { loadRun } from '../db/runRepository'
import { getMemoryStore, petampCharacter } from '../character'
import type { EpisodicMemory } from '../character'
import type { Run } from '../types'

// 画面中央タップの再生/停止トグル対象外にする要素 (ボタン類・吹き出し・パネル)。
const TAP_TOGGLE_IGNORE =
  'button, a, input, .run-detail-meta, .run-detail-bubble, .run-detail-bubble-backdrop, .debug-overlay, .nutrition-facts-panel, .run-detail-tabs'

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  // ラン終了直後の co-run ライブフロー (RecordingPage から遷移) かどうか。
  const coRunLive = !!(location.state as { coRunLive?: boolean } | null)?.coRunLive
  const liveMyRunId = (location.state as { myRunId?: string } | null)?.myRunId ?? null
  const [run, setRun] = useState<Run | null>(null)
  // 軌跡リプレイ / 成分表示 (Nutrition Facts) のタブ切替。
  const [detailTab, setDetailTab] = useState<'replay' | 'nutrition'>('replay')
  const [mapVisible, setMapVisible] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [memories, setMemories] = useState<EpisodicMemory[]>([])
  const [bubbleOpen, setBubbleOpen] = useState(false)
  const eyeRef = useRef<HTMLButtonElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const { runs, loadRuns } = useRunStore()
  const followedRuns = useSocialFeedStore(s => s.followedRuns)
  const followedUsers = useSocialFeedStore(s => s.followedUsers)
  const { user: currentUser } = useAuth()
  const [runsLoaded, setRunsLoaded] = useState(false)
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

  // 画面中央タップで再生/停止トグル + 一瞬出す再生/停止アイコン。
  const tapFlash = useReplayTapToggle(play, stop, reset, TAP_TOGGLE_IGNORE)

  const acceptedRunPoints = useMemo(() => acceptedPoints(run?.trackPoints ?? []), [run])
  const { gain } = useElevationStats(acceptedRunPoints)

  // バブルの位置を eyeRef から計算 (multi-line で高さが変わるので memories でも再計測)
  useRunBubblePositioning(eyeRef, bubbleRef, bubbleOpen, memories, { offsetX: 18, gap: 12 })

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
  const coRunAvatars = useCoRunAvatars(coRunEntries)

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
  useRunMetadata(run, setRun, !isOthers)

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
            <DetailLayers
              run={run}
              currentTime={currentTime}
              mapVisible={mapVisible}
              palette={runPalette}
              pointCloud={detailTab === 'nutrition'}
            />
          )}
        </BaseMap>
      </div>

      {detailTab === 'nutrition' && (
        <div className="nutrition-facts-panel">
          <NutritionFacts run={run} />
        </div>
      )}

      <div className="run-detail-tabs" role="tablist" aria-label="表示の切替">
        <button
          type="button"
          role="tab"
          aria-selected={detailTab === 'replay'}
          className={`run-detail-tab${detailTab === 'replay' ? ' is-active' : ''}`}
          onClick={() => setDetailTab('replay')}
        >
          TRAIL
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={detailTab === 'nutrition'}
          className={`run-detail-tab${detailTab === 'nutrition' ? ' is-active' : ''}`}
          onClick={() => setDetailTab('nutrition')}
        >
          NUTRITION
        </button>
      </div>

      <button className="back-btn" onClick={() => navigate('/')} aria-label="閉じる">
        <Icon icon="lucide:x" />
      </button>
      {detailTab === 'replay' && (
        <button
          className={`map-toggle-btn ${!mapVisible ? 'active' : ''}`}
          onClick={() => setMapVisible(v => !v)}
          title={mapVisible ? 'マップ非表示' : 'マップ表示'}
          aria-label={mapVisible ? 'マップ非表示' : 'マップ表示'}
        >
          <Icon icon={mapVisible ? 'lucide:map-pin-off' : 'lucide:map'} />
        </button>
      )}
      {detailTab === 'replay' && !isOthers && (
        <button
          className="debug-btn"
          onClick={() => setDebugOpen(true)}
          title="パスデータを表示"
          aria-label="パスデータを表示"
        >
          <Icon icon="lucide:braces" />
        </button>
      )}

      {/* ライブ co-run フロー中は前後ランナビではなく「次へ」(対話へ進む) を出す。
          前後ラン (左右移動) は TRAIL / NUTRITION 両タブで使える。 */}
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

      {detailTab === 'replay' && (
        <div className="run-detail-meta">
          {run.areaName && <div className="run-detail-meta-name">{run.areaName}</div>}
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
      )}

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
          Tapping pops a bubble; the bubble's inline link enters the chat.
          TRAIL / NUTRITION 両タブで背景に居続ける (ペタンプの顔)。 */}
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
