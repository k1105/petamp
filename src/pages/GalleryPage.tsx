import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers'
import { Icon } from '@iconify/react'
import { BaseMap } from '../components/map/BaseMap'
import { useMap, useMapZoom } from '../components/map/MapContext'
import { DeckOverlay } from '../components/map/DeckOverlay'
import { AreaLabel } from '../components/map/AreaLabel'
import { MapBoundsConstraint } from '../components/map/MapBoundsConstraint'
import { GroupEdgeIndicator } from '../components/map/GroupEdgeIndicator'
import { expandBboxByMeters } from '../utils/runBbox'
import { groupRunsByBboxOverlap, makeHomeGroup, findGroupContaining } from '../utils/runGroups'
import { useRunStore } from '../store/useRunStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useSocialFeedStore } from '../store/useSocialFeedStore'
import { SettingsPanel } from '../components/gallery/SettingsPanel'
import { UserMenu } from '../components/UserMenu'
import { RunTile } from '../components/gallery/RunTile'
import { EyesIcon } from '../components/gallery/EyesIcon'
import { IslandView } from '../components/island/IslandView'
import { StatsView } from '../components/gallery/StatsView'
import { computeArchipelagoLayout, type ArchipelagoLayoutResult } from '../utils/archipelagoLayout'
import { buildPathPositions } from '../utils/tubeMesh'
import { effectiveRadius } from '../utils/effectiveRadius'
import { acceptedPoints } from '../utils/recordingFilters'
import { useGalleryAnimation } from '../hooks/useGalleryAnimation'
import { hexToRgb } from '../utils/themePalettes'
import { useActivePalette } from '../hooks/useActivePalette'
import { useCurrentPosition } from '../hooks/useCurrentPosition'
import { useHomePhrase } from '../hooks/useHomePhrase'
import { useMetaballSheet } from '../hooks/useMetaballSheet'
import { useTransitionStore } from '../store/useTransitionStore'
import type { DotPosition } from '../hooks/useGalleryAnimation'
import type { Run } from '../types'

const MIN_ZOOM = 12.5
// 現在位置(=自己位置)dotは過去ランの軌跡dotより少し大きく強調する。
const CURRENT_DOT_SCALE = 1.2

// FAB タップで現在位置に home スケールでフォーカスする (homeGroup が無い
// = GPS が realGroup 内のケース用)。signal を increment するたびに flyTo。
function FocusGPS({ signal, center, zoom }: { signal: number; center: [number, number] | null; zoom: number }) {
  const { map } = useMap()
  const lastRef = useRef(0)
  useEffect(() => {
    if (!map || !center || signal === 0 || signal === lastRef.current) return
    lastRef.current = signal
    map.flyTo({ center, zoom, duration: 700 })
  }, [signal, map, center, zoom])
  return null
}

function GalleryLayers({
  runs,
  dots,
  currentPosition,
}: {
  runs: Run[]
  dots: DotPosition[]
  currentPosition: [number, number] | null
}) {
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
  const currentDotColor: [number, number, number, number] = [...accentRgb, 255]

  const dotRadius = effectiveRadius(zoom, radii.zoomThreshold, radii.dotRadius)
  const tubeWidth = effectiveRadius(zoom, radii.zoomThreshold, radii.tubeRadius) * 2

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

  const layers = useMemo(() => {
    if (t === 0) return []
    const tubeLayer = new PathLayer<{ id: string; path: [number, number, number][] }>({
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
      onClick: info => {
        if (info.object) navigate(`/run/${info.object.id}`)
      },
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
      updateTriggers: { getFillColor: dotColor },
    })
    const currentPosLayer = currentPosition
      ? new ScatterplotLayer({
          id: 'gallery-current-pos',
          data: [{ position: currentPosition }],
          getPosition: (d: { position: [number, number] }) => [d.position[0], d.position[1], 0],
          getRadius: dotRadius * CURRENT_DOT_SCALE,
          radiusUnits: 'meters',
          getFillColor: currentDotColor,
          billboard: true,
        })
      : null
    return [tubeLayer, dotsLayer, ...(currentPosLayer ? [currentPosLayer] : [])]
  }, [runPaths, dots, currentPosition, t, dotRadius, tubeWidth, tubeColor, dotColor, currentDotColor, navigate])

  return <DeckOverlay layers={layers} />
}

// Home (initial) state config — small fixed-size cage centred on GPS at a
// fixed zoom, distinct from any recorded group. Pan-to-edge from here jumps
// to the nearest real group.
const HOME_HALF_SIZE_METERS = 150
const HOME_FIXED_ZOOM = 17.5

// Fallback phrases used while the LLM ambient phrase isn't ready (no API key,
// network failure, or still generating). Picked once per arm; not cycled.
const FALLBACK_PHRASES = [
  'このへんは初めてだ',
  'ホームグラウンド！',
  '今日はさかみちある？',
] as const

function pickFallback(): string {
  return FALLBACK_PHRASES[Math.floor(Math.random() * FALLBACK_PHRASES.length)]
}

export function GalleryPage() {
  const { runs, loadRuns, removeRun } = useRunStore()
  const followedRuns = useSocialFeedStore(s => s.followedRuns)
  const followedUsers = useSocialFeedStore(s => s.followedUsers)
  const ui = useSettingsStore(s => s.ui)
  const setUi = useSettingsStore(s => s.setUi)

  // TRAIL / ISLAND タブにはフォロー中ユーザーのランも混ぜて表示する。
  // マップ・dot アニメ・home phrase・STATS は今まで通り自分のランのみ。
  const socialRuns = useMemo(
    () => [...runs, ...followedRuns].sort((a, b) => b.startedAt - a.startedAt),
    [runs, followedRuns],
  )
  const ownerByUid = useMemo(() => {
    const m = new Map<string, typeof followedUsers[number]>()
    for (const u of followedUsers) m.set(u.uid, u)
    return m
  }, [followedUsers])
  const [view, setView] = useState<'map' | 'list' | 'settings'>('map')
  const [listMode, setListMode] = useState<'trail' | 'island' | 'stats'>('trail')
  const [armed, setArmed] = useState(false)
  const [focusGPSSignal, setFocusGPSSignal] = useState(0)
  const [bubblePhrase, setBubblePhrase] = useState<string | null>(null)
  const [showFirstRunIntro, setShowFirstRunIntro] = useState(false)
  // ホーム画面 (Gallery) は通常 1/10 のスローモー: 60 → 6
  const dots = useGalleryAnimation(runs, 6)
  const initialCenter = useCurrentPosition()
  const [searchParams] = useSearchParams()
  const isDebug = searchParams.get('debug') === '1'

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const speechBubbleRef = useRef<HTMLButtonElement>(null)
  const startLabelRef = useRef<HTMLDivElement>(null)
  const armedRef = useRef(armed)
  // armed の最新値を sheet 描画ループから参照するため ref に同期する。
  // eslint-disable-next-line react-hooks/refs
  armedRef.current = armed
  useMetaballSheet({ canvasRef, sheetRef, fabRef, armedRef })

  // view / armed が変わる (= FAB が動く) たびに 1 回まばたき。初回マウントは
  // スキップ。signal は単調増加 (number) で EyesIcon に渡し、値の変化を検出
  // させる。
  const [blinkSignal, setBlinkSignal] = useState(0)
  const blinkDidMountRef = useRef(false)
  useEffect(() => {
    if (!blinkDidMountRef.current) {
      blinkDidMountRef.current = true
      return
    }
    setBlinkSignal(s => s + 1)
  }, [view, armed])

  // パネル中身は active のときだけ mount。閉じてもスライドアウト中は残し、
  // トランジション完了後 (350ms) に unmount する。これで GalleryPage 初回
  // マウント時に run-tile 全件や SettingsPanel が同期描画されてマップ表示を
  // 遅らせるのを避ける。
  const PANEL_TRANSITION_MS = 350
  const [listMounted, setListMounted] = useState(false)
  const [settingsMounted, setSettingsMounted] = useState(false)
  useEffect(() => {
    if (view === 'list') {
      // パネルを開く瞬間に同期マウントする (open class 適用と同フレームで)。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setListMounted(true)
      return
    }
    if (!listMounted) return
    const t = window.setTimeout(() => setListMounted(false), PANEL_TRANSITION_MS)
    return () => window.clearTimeout(t)
  }, [view, listMounted])
  useEffect(() => {
    if (view === 'settings') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettingsMounted(true)
      return
    }
    if (!settingsMounted) return
    const t = window.setTimeout(() => setSettingsMounted(false), PANEL_TRANSITION_MS)
    return () => window.clearTimeout(t)
  }, [view, settingsMounted])

  const [runsLoaded, setRunsLoaded] = useState(false)
  useEffect(() => {
    loadRuns(isDebug).finally(() => setRunsLoaded(true))
  }, [isDebug])

  // ISLAND タブの archipelago layout はマウントするたびに再計算すると重いので、
  // GalleryPage 側に持ち上げて runs 参照単位でキャッシュする。ISLAND タブが
  // 初めて開かれたタイミングで非同期 (1 フレーム後) に計算してローディングを
  // 描画してから走らせる。
  const [archLayout, setArchLayout] = useState<ArchipelagoLayoutResult | null>(null)
  const [archLoading, setArchLoading] = useState(false)
  const archLayoutRunsRef = useRef<Run[] | null>(null)
  // 計算中フラグは ref で持つ。state にすると依存に入れた effect が自身を
  // キャンセルして二度と rAF が走らなくなる。
  const archInFlightRef = useRef(false)

  // socialRuns 参照が変わったら layout を破棄。
  useEffect(() => {
    if (archLayoutRunsRef.current !== null && archLayoutRunsRef.current !== socialRuns) {
      archLayoutRunsRef.current = null
      // socialRuns 入れ替えで前回キャッシュを破棄するための同期 reset。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setArchLayout(null)
    }
  }, [socialRuns])

  useEffect(() => {
    if (listMode !== 'island') return
    if (archLayoutRunsRef.current === socialRuns) return
    if (archInFlightRef.current) return
    if (socialRuns.length === 0) return
    archInFlightRef.current = true
    // rAF 計算前にローディング UI を確実に描画させるための同期セット。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setArchLoading(true)
    const target = socialRuns
    // rAF で 1 フレーム譲ってローディング UI を確実に描画してから計算。
    const raf = requestAnimationFrame(() => {
      const result = computeArchipelagoLayout(target)
      archLayoutRunsRef.current = target
      archInFlightRef.current = false
      setArchLayout(result)
      setArchLoading(false)
    })
    return () => {
      cancelAnimationFrame(raf)
      archInFlightRef.current = false
    }
  }, [listMode, socialRuns])

  // 初回ラン完了後にトップへ戻ってきたタイミングで一度だけ案内を出す。
  useEffect(() => {
    if (!runsLoaded) return
    if (ui.hasSeenFirstRunIntro) return
    if (runs.length !== 1) return
    // 初回ラン完了直後にだけ案内モーダルを出す one-shot トリガー。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowFirstRunIntro(true)
  }, [runsLoaded, runs.length, ui.hasSeenFirstRunIntro])

  const dismissFirstRunIntro = () => {
    setShowFirstRunIntro(false)
    setUi({ hasSeenFirstRunIntro: true })
  }

  // Phase 2: cluster runs into actual groups.
  const realGroups = useMemo(
    () => groupRunsByBboxOverlap(runs, ui.mapPaddingMeters),
    [runs, ui.mapPaddingMeters],
  )

  // 現在位置が既存グループ (padded bbox) に含まれていればそのグループに合流。
  // 含まれていない場合のみ home pseudo-group を生成する。
  const containingRealGroup = useMemo(
    () => (initialCenter ? findGroupContaining(realGroups, initialCenter, ui.mapPaddingMeters) : null),
    [initialCenter, realGroups, ui.mapPaddingMeters],
  )

  // Phase 4: synthesise a "home" pseudo-group at GPS so the initial mount
  // sits at a small fixed cage instead of snapping into a recorded group.
  const homeGroup = useMemo(
    () => (initialCenter && !containingRealGroup ? makeHomeGroup(initialCenter, HOME_HALF_SIZE_METERS) : null),
    [initialCenter, containingRealGroup],
  )

  // Combined list passed to GroupNavigation — pan-to-edge can move between
  // home and any real group, and between real groups.
  const allGroups = useMemo(
    () => (homeGroup ? [homeGroup, ...realGroups] : realGroups),
    [homeGroup, realGroups],
  )

  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null)
  // GPS確定 (success or null) を待ってから default group を決める。
  // これでBaseMap マウント時から正しい中心 (= 現在位置 home) で立ち上がり、
  // 「先にrealGroupに着地→後からhomeへ animate」のずれが起きない。
  useEffect(() => {
    if (!runsLoaded) return
    if (initialCenter === undefined) return
    if (currentGroupId && allGroups.some(g => g.id === currentGroupId)) return
    if (homeGroup) {
      // GPS 確定後の default group 選択。複数候補をまとめて初期化する都合上同期セット。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentGroupId('home')
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentGroupId(containingRealGroup?.id ?? realGroups[0]?.id ?? null)
    }
  }, [runsLoaded, allGroups, currentGroupId, homeGroup, containingRealGroup, realGroups, initialCenter])

  const currentGroup = useMemo(
    () => allGroups.find(g => g.id === currentGroupId) ?? null,
    [allGroups, currentGroupId],
  )

  const isHome = currentGroup?.id === 'home'

  // BaseMap initial position. Home: GPS center + fixed zoom (no `bounds`
  // option since we want the explicit fixed scale, not bbox-fit). Real
  // group: padded bbox passed via `bounds` for tight fit.
  // 例外: 現在位置が realGroup に含まれている初期状態では home スケールで
  // 立ち上げる (bounds を渡さない)。MapBoundsConstraint が group bbox を
  // maxBounds として後から適用する。
  const initialBounds = useMemo(() => {
    if (!runsLoaded || !currentGroup || isHome) return undefined
    if (containingRealGroup && currentGroup.id === containingRealGroup.id) return undefined
    return expandBboxByMeters(currentGroup.bbox, ui.mapPaddingMeters) as [[number, number], [number, number]]
  }, [runsLoaded, currentGroup, isHome, ui.mapPaddingMeters, containingRealGroup])

  const homePhrase = useHomePhrase(initialCenter ?? undefined, runs, runsLoaded)

  useEffect(() => {
    // armed 切替時に bubble phrase を一括更新する。pickFallback がランダム要素を
    // 持つため useMemo 化せず effect に置いている。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (armed) setBubblePhrase(homePhrase ?? pickFallback())
    // eslint-disable-next-line react-hooks/set-state-in-effect
    else setBubblePhrase(null)
  }, [armed, homePhrase])

  // 未記録ユーザー向けの CTA テキスト。armed 時は通常の発話 bubble に置き換わる。
  const onboardingPhrase = !armed && runs.length === 0 ? 'TAP HERE!' : null
  const activeBubbleText = armed ? bubblePhrase : onboardingPhrase
  const isOnboardingBubble = !armed && activeBubbleText !== null

  // Position the speech bubble + start label relative to the FAB's actual
  // bounding rect each frame. armed 時は start-label も追従。
  useEffect(() => {
    if (!activeBubbleText) return
    let raf = 0
    const tick = () => {
      const fab = fabRef.current
      if (fab) {
        const r = fab.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const bubble = speechBubbleRef.current
        if (bubble) {
          bubble.style.left = `${cx - bubble.offsetWidth / 2}px`
          bubble.style.top = `${r.top - 16 - bubble.offsetHeight}px`
        }
        if (armed) {
          const label = startLabelRef.current
          if (label) {
            label.style.left = `${cx - label.offsetWidth / 2}px`
            label.style.top = `${r.bottom + 18}px`
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [armed, activeBubbleText])

  const handleRunSelect = (runId: string) => {
    const fab = fabRef.current
    if (!fab) return
    const rect = fab.getBoundingClientRect()
    const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    useTransitionStore.getState().startRunDetail(origin, runId)
  }

  const handleFabClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (armed) {
      const fab = fabRef.current
      if (!fab) return
      const rect = fab.getBoundingClientRect()
      const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      // Snapshot the area name (if any) from the current AreaLabel render so the
      // transition overlay can display it during the iris-paused phase. Reading
      // the DOM avoids reaching into the BaseMap context from outside.
      const areaName = document.querySelector('.area-label')?.textContent ?? null
      useTransitionStore.getState().startRecord(origin, areaName)
      // Navigation to /record is performed by the overlay when the iris phase begins.
      return
    }
    // 別groupにいる場合は GPS 焦点へジャンプしつつ、同じタップで arm まで進める
    // (旧仕様は2タップ必要だったが、1タップで record 確認モーダルへ)。
    // homeGroup があるケース: home へ切替えるだけで home スケールになる。
    // containingRealGroup ケース: group identity は維持しつつ camera を home
    // スケールに flyTo (FocusGPS が signal 変化で flyTo を発火する)。
    if (homeGroup) {
      if (currentGroupId !== 'home') setCurrentGroupId('home')
    } else if (containingRealGroup) {
      if (currentGroupId !== containingRealGroup.id) setCurrentGroupId(containingRealGroup.id)
      setFocusGPSSignal(s => s + 1)
    }
    setArmed(true)
    setView('map')
  }

  const toggleView = (target: 'list' | 'settings') => {
    if (armed) return
    setView(current => (current === target ? 'map' : target))
  }

  return (
    <div className="page">
      <UserMenu />
      <div className="map-container">
        {initialCenter !== undefined && runsLoaded && (
          <BaseMap
            initialCenter={initialCenter ?? undefined}
            initialZoom={HOME_FIXED_ZOOM}
            initialBounds={initialBounds}
          >
            <GalleryLayers runs={runs} dots={dots} currentPosition={initialCenter ?? null} />
            <AreaLabel />
            <MapBoundsConstraint
              bbox={currentGroup?.bbox ?? null}
              paddingMeters={ui.mapPaddingMeters}
              fixedMinZoom={isHome ? HOME_FIXED_ZOOM : undefined}
            />
            <FocusGPS
              signal={focusGPSSignal}
              center={initialCenter ?? null}
              zoom={HOME_FIXED_ZOOM}
            />
            <GroupEdgeIndicator
              currentGroup={currentGroup}
              groups={allGroups}
              onTap={setCurrentGroupId}
            />
          </BaseMap>
        )}
      </div>

      <div className={`gallery-panel gallery-panel-list${view === 'list' ? ' open' : ''}`}>
        {listMounted && (
          <>
            <div className="list-mode-header">
              <div className="list-mode-toggle" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={listMode === 'trail'}
                  className={`list-mode-toggle-btn${listMode === 'trail' ? ' is-active' : ''}`}
                  onClick={() => setListMode('trail')}
                >
                  TRAIL
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={listMode === 'island'}
                  className={`list-mode-toggle-btn${listMode === 'island' ? ' is-active' : ''}`}
                  onClick={() => setListMode('island')}
                >
                  ISLAND
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={listMode === 'stats'}
                  className={`list-mode-toggle-btn${listMode === 'stats' ? ' is-active' : ''}`}
                  onClick={() => setListMode('stats')}
                >
                  STATS
                </button>
              </div>
            </div>
            {socialRuns.length === 0 ? (
              <p className="empty-hint">記録したランがここに表示されます</p>
            ) : listMode === 'trail' ? (
              <div className="run-grid">
                {socialRuns.map(run => (
                  <RunTile
                    key={run.id}
                    run={run}
                    owner={run.ownerUid ? ownerByUid.get(run.ownerUid) ?? null : null}
                    onDelete={removeRun}
                    onSelect={handleRunSelect}
                  />
                ))}
              </div>
            ) : listMode === 'island' ? (
              <div className="island-view-wrap">
                <IslandView
                  layout={archLayout}
                  loading={archLoading}
                  socialRuns={socialRuns}
                  ownerByUid={ownerByUid}
                />
              </div>
            ) : (
              <div className="stats-view-wrap">
                <StatsView runs={runs} />
              </div>
            )}
          </>
        )}
      </div>

      <div className={`gallery-panel gallery-panel-settings${view === 'settings' ? ' open' : ''}`}>
        {settingsMounted && <SettingsPanel />}
      </div>

      {armed && <div className="armed-backdrop" onClick={() => setArmed(false)} />}
      {activeBubbleText && (
        <button
          ref={speechBubbleRef}
          key={activeBubbleText}
          className={`speech-bubble${isOnboardingBubble ? ' speech-bubble-onboarding' : ''}`}
          onClick={(e) => e.stopPropagation()}
          aria-label={`発話: ${activeBubbleText}`}
        >
          {activeBubbleText}
        </button>
      )}
      {armed && <div ref={startLabelRef} className="start-label">TAP TO START</div>}

      <canvas ref={canvasRef} className="metaball-canvas" />

      <div ref={sheetRef} className={`bottom-sheet ${armed ? 'armed' : ''}`}>
        <div className="bottom-sheet-shape">
          {runs.length > 0 && (
            <button
              className={`list-toggle-btn${view === 'list' ? ' is-active' : ''}`}
              onClick={() => toggleView('list')}
              aria-label={view === 'list' ? 'ラン一覧を閉じる' : 'ラン一覧を開く'}
            >
              <Icon icon="lucide:layout-list" />
            </button>
          )}
          <button
            ref={fabRef}
            className={`fab fab-sheet${view !== 'map' && !armed ? ` fab-pos-${view}` : ''}${!armed ? ' fab-idle' : ''}`}
            onClick={handleFabClick}
            aria-label={armed ? 'TAP TO START' : '記録開始'}
          >
            <span className="fab-icon" style={{ width: ui.fabIconSize, height: ui.fabIconSize }}><EyesIcon blinkSignal={blinkSignal} /></span>
          </button>
          <button
            className={`map-btn${view === 'map' ? ' is-active' : ''}`}
            onClick={() => { if (!armed) setView('map') }}
            aria-label="マップに戻る"
            title="マップ"
          >
            <Icon icon="lucide:map" />
          </button>
          <button
            className={`settings-btn${view === 'settings' ? ' is-active' : ''}`}
            onClick={() => toggleView('settings')}
            aria-label={view === 'settings' ? '設定を閉じる' : '設定を開く'}
            title="設定"
          >
            <Icon icon="lucide:settings" />
          </button>
        </div>
      </div>

      {showFirstRunIntro && (
        <div className="first-run-intro" role="dialog" aria-label="最初のランの案内">
          <div className="first-run-intro-inner">
            <h2 className="first-run-intro-title">最初のラン、お疲れさまでした！</h2>
            <p className="first-run-intro-body">
              ペタンプは、あなたの住む世界のことを何も知らない存在です。ランニングの記録をつけたら、そのランニングがどんな体験だったかをペタンプに教えてあげることで、ペタンプはどんどん成長していきます。もしかすると、あなたも知らなかった自分の好みや、このセカイのことに気づかせてくれるようになるかもしれません。
            </p>
            <button className="first-run-intro-ok" onClick={dismissFirstRunIntro}>
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
