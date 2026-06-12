import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { BaseMap } from '../components/map/BaseMap'
import { AreaLabel } from '../components/map/AreaLabel'
import { NowPlayingLabel } from '../components/map/NowPlayingLabel'
import { MapBoundsConstraint } from '../components/map/MapBoundsConstraint'
import { GroupEdgeIndicator } from '../components/map/GroupEdgeIndicator'
import { NamedPlaceMapLayers } from '../components/map/NamedPlaceMapLayers'
import { FocusGPS, type Padding } from '../components/map/FocusGPS'
import { GalleryLayers } from '../components/gallery/GalleryLayers'
import { GalleryListPanel } from '../components/gallery/GalleryListPanel'
import { NamedPlacePopup } from '../components/gallery/NamedPlacePopup'
import { FirstRunIntro } from '../components/gallery/FirstRunIntro'
import { SettingsPopup } from '../components/gallery/SettingsPopup'
import { RunEditSheet } from '../components/gallery/RunEditSheet'
import { EyesIcon } from '../components/gallery/EyesIcon'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { ProfileScreen } from '../components/profile/ProfileScreen'
import { MovementTypeSelector } from '../components/gallery/MovementTypeSelector'
import { useRunStore } from '../store/useRunStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useJoystickStore } from '../store/useJoystickStore'
import { useTransitionStore } from '../store/useTransitionStore'
import { useCoRunStore } from '../store/useCoRunStore'
import { useAuth } from '../hooks/useAuth'
import { useEyeParams } from '../hooks/useEyeParams'
import { useGalleryAnimation } from '../hooks/useGalleryAnimation'
import { useActivePalette } from '../hooks/useActivePalette'
import { useCurrentPosition } from '../hooks/useCurrentPosition'
import { useHomePhrase } from '../hooks/useHomePhrase'
import { useMetaballSheet } from '../hooks/useMetaballSheet'
import { useNamedPlaces } from '../hooks/useNamedPlaces'
import { useGroupNavigation, HOME_FIXED_ZOOM } from '../hooks/useGroupNavigation'
import { useFabStackPositioning } from '../hooks/useFabStackPositioning'
import { DEFAULT_MOVEMENT_TYPE } from '../utils/run/movementType'
import type { MovementType } from '../types'
import type { NamedPlace } from '../character/domain/memory'

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
  const { runs, loadRuns, removeRun, updateRun } = useRunStore()
  const ui = useSettingsStore(s => s.ui)
  const setUi = useSettingsStore(s => s.setUi)

  const [view, setView] = useState<'map' | 'list' | 'profile'>('map')
  // 長押しで開く編集シート対象のラン id。fixed 配置のシート/ダイアログは
  // transform を持つ gallery-panel の外 (ページルート) で出す必要があるため、
  // 状態はパネルではなくページが持つ。
  const [editingRunId, setEditingRunId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  // ラン開始前 (armed 状態) に選ぶ移動種別。startRecord で /record へ引き継ぐ。
  const [movementType, setMovementType] = useState<MovementType>(DEFAULT_MOVEMENT_TYPE)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { user } = useAuth()
  const [armed, setArmed] = useState(false)
  // 4キーフレーム (map / list / profile / armed)。armed > view を優先。
  const navState = armed ? 'armed' : view
  const eyeParams = useEyeParams(navState)
  const [focusGPSSignal, setFocusGPSSignal] = useState(0)
  // GPS フォーカス時、現在位置を画面中心ではなく FAB(顔) の位置に置くための flyTo padding。
  const [gpsFocusPadding, setGpsFocusPadding] = useState<Padding>({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  })
  const { places: namedPlaces } = useNamedPlaces()
  const [selectedPlace, setSelectedPlace] = useState<NamedPlace | null>(null)
  const [bubblePhrase, setBubblePhrase] = useState<string | null>(null)
  const [showFirstRunIntro, setShowFirstRunIntro] = useState(false)
  // ホーム画面 (Gallery) は通常 1/10 のスローモー: 60 → 6
  const dots = useGalleryAnimation(runs, 6)
  const initialCenter = useCurrentPosition()
  const [searchParams] = useSearchParams()
  const isDebug = searchParams.get('debug') === '1'
  // ActivePaletteProvider 配下であることを保証する (palette は GalleryLayers が参照)。
  useActivePalette()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const speechBubbleRef = useRef<HTMLButtonElement>(null)
  const startLabelRef = useRef<HTMLDivElement>(null)
  const coRunEntryRef = useRef<HTMLButtonElement>(null)
  const movementSelectorRef = useRef<HTMLDivElement>(null)
  const armedRef = useRef(armed)
  // armed の最新値を sheet 描画ループから参照するため ref に同期する。
  // eslint-disable-next-line react-hooks/refs
  armedRef.current = armed
  // joystick armed (= petamp が MapJoystick 側に飛び移っている) 中は global
  // canvas の peak を消す。
  const joystickArmed = useJoystickStore(s => s.armed)
  const peakHiddenRef = useRef(joystickArmed)
  // eslint-disable-next-line react-hooks/refs
  peakHiddenRef.current = joystickArmed
  // disarm 中は FAB 自体が slide-up 移動中で live rect が動くため、arm 時点
  // の元位置 rect を store から取って peak position 固定用に渡す。
  const storedFabRect = useJoystickStore(s => s.storedFabRect)
  const peakRectOverrideRef = useRef(storedFabRect)
  // eslint-disable-next-line react-hooks/refs
  peakRectOverrideRef.current = storedFabRect
  useMetaballSheet({ canvasRef, sheetRef, fabRef, armedRef, peakHiddenRef, peakRectOverrideRef })

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

  // armed 中は nav アイコン (list/map/profile) が隠れるのに合わせ、map 上に居残る
  // MapJoystick (translate/rotate 切替の円) も隠す。armed-backdrop が透明なため
  // CSS で明示的に消さないと取り残されて見えてしまう。
  useEffect(() => {
    document.body.classList.toggle('gallery-armed', armed)
    return () => document.body.classList.remove('gallery-armed')
  }, [armed])

  // パネル中身は初めて開かれるまで mount しない (初回マウント時に run-tile 全件や
  // SettingsPanel が同期描画されてマップ表示が遅れるのを避ける lazy mount)。
  // 一度 mount したら閉じてもアンマウントしない: IslandView (deck.gl Deck / area
  // name fetch / circular avatar 生成) の高コストな再構築を避ける。パネル本体は
  // CSS の transform でオフスクリーンに退避しているので、mount したままでも
  // 視覚的には隠れ、deck.gl は on-demand 描画なのでアイドル時のコストは無視できる。
  const [listMounted, setListMounted] = useState(false)
  const [profileMounted, setProfileMounted] = useState(false)
  useEffect(() => {
    if (view !== 'list' || listMounted) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setListMounted(true)
  }, [view, listMounted])
  useEffect(() => {
    if (view !== 'profile' || profileMounted) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfileMounted(true)
  }, [view, profileMounted])

  const [runsLoaded, setRunsLoaded] = useState(false)
  useEffect(() => {
    loadRuns(isDebug).finally(() => setRunsLoaded(true))
  }, [isDebug])

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

  const {
    allGroups,
    currentGroup,
    currentGroupId,
    setCurrentGroupId,
    isHome,
    containingRealGroup,
    homeGroup,
    initialBounds,
  } = useGroupNavigation(runs, ui.mapPaddingMeters, initialCenter, runsLoaded)

  const homePhrase = useHomePhrase(initialCenter ?? undefined, runs, runsLoaded)

  useEffect(() => {
    // armed 切替時に bubble phrase を一括更新する。pickFallback がランダム要素を
    // 持つため useMemo 化せず effect に置いている。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (armed) setBubblePhrase(homePhrase ?? pickFallback())
    else setBubblePhrase(null)
  }, [armed, homePhrase])

  // 未記録ユーザー向けの CTA テキスト。armed 時は通常の発話 bubble に置き換わる。
  const onboardingPhrase = !armed && runs.length === 0 ? 'TAP HERE!' : null
  const activeBubbleText = armed ? bubblePhrase : onboardingPhrase
  const isOnboardingBubble = !armed && activeBubbleText !== null

  useFabStackPositioning(
    { fabRef, speechBubbleRef, movementSelectorRef, startLabelRef, coRunEntryRef },
    armed,
    activeBubbleText,
  )

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
      useTransitionStore.getState().startRecord(origin, areaName, null, { movementType })
      // Navigation to /record is performed by the overlay when the iris phase begins.
      return
    }
    // タップで現在位置へジャンプしつつ、同じタップで arm まで進める
    // (旧仕様は2タップ必要だったが、1タップで record 確認モーダルへ)。
    // group identity を更新: home があれば home、なければ GPS を含む実 group へ。
    if (homeGroup) {
      if (currentGroupId !== 'home') setCurrentGroupId('home')
    } else if (containingRealGroup) {
      if (currentGroupId !== containingRealGroup.id) setCurrentGroupId(containingRealGroup.id)
    }
    // 現在位置へ flyTo。光学的中心が画面中心ではなく FAB(顔) の中心に来るよう
    // padding を計算して渡す (padding は viewport を縮めて中心をずらすので maxBounds 下でも効く)。
    // home/real どちらのケースでも必ず発火させる (FocusGPS が signal 変化で flyTo)。
    const fab = fabRef.current
    if (fab) {
      const rr = fab.getBoundingClientRect()
      const dx = rr.left + rr.width / 2 - window.innerWidth / 2
      const dy = rr.top + rr.height / 2 - window.innerHeight / 2
      // 光学的中心 = (left + (W-right))/2, (top + (H-bottom))/2。
      // これを (W/2+dx, H/2+dy) にしたいので left-right=2dx, top-bottom=2dy。
      setGpsFocusPadding({
        top: Math.max(0, 2 * dy),
        bottom: Math.max(0, -2 * dy),
        left: Math.max(0, 2 * dx),
        right: Math.max(0, -2 * dx),
      })
    }
    setFocusGPSSignal(s => s + 1)
    setArmed(true)
    setView('map')
  }

  const toggleView = (target: 'list' | 'profile') => {
    if (armed) return
    setView(current => (current === target ? 'map' : target))
  }

  return (
    <div className={`page${armed ? ' armed' : ''}`}>
      <button
        type="button"
        className="top-settings-btn"
        onClick={() => setSettingsOpen(true)}
        aria-label="設定を開く"
        title="設定"
      >
        <Icon icon="lucide:settings" />
      </button>
      <div className="map-container">
        <div className="map-dim" aria-hidden="true" />
        {initialCenter !== undefined && runsLoaded && (
          <BaseMap
            initialCenter={initialCenter ?? undefined}
            initialZoom={HOME_FIXED_ZOOM}
            initialBounds={initialBounds}
          >
            <GalleryLayers runs={runs} dots={dots} />
            <NamedPlaceMapLayers places={namedPlaces} onPick={setSelectedPlace} />
            <AreaLabel />
            <NowPlayingLabel />
            <MapBoundsConstraint
              bbox={currentGroup?.bbox ?? null}
              paddingMeters={ui.mapPaddingMeters}
              fixedMinZoom={isHome ? HOME_FIXED_ZOOM : undefined}
            />
            <FocusGPS
              signal={focusGPSSignal}
              center={initialCenter ?? null}
              zoom={HOME_FIXED_ZOOM}
              padding={gpsFocusPadding}
            />
            <GroupEdgeIndicator
              currentGroup={currentGroup}
              groups={allGroups}
              onTap={setCurrentGroupId}
            />
          </BaseMap>
        )}
        {selectedPlace && (
          <NamedPlacePopup
            place={selectedPlace}
            onClose={() => setSelectedPlace(null)}
          />
        )}
      </div>

      <div className={`gallery-panel gallery-panel-list${view === 'list' ? ' open' : ''}`}>
        {listMounted && (
          <GalleryListPanel onSelectRun={handleRunSelect} onRequestEdit={setEditingRunId} />
        )}
      </div>

      <div className={`gallery-panel gallery-panel-profile${view === 'profile' ? ' open' : ''}`}>
        {profileMounted && (
          <ProfileScreen
            runs={runs}
            onClose={() => { if (!armed) setView('map') }}
          />
        )}
      </div>

      {settingsOpen && <SettingsPopup onClose={() => setSettingsOpen(false)} />}

      {editingRunId && (() => {
        const editingRun = runs.find(r => r.id === editingRunId)
        if (!editingRun) return null
        return (
          <RunEditSheet
            run={editingRun}
            onChangeType={type => {
              void updateRun(editingRun.id, { movementType: type })
            }}
            onDelete={() => {
              setEditingRunId(null)
              setPendingDeleteId(editingRun.id)
            }}
            onClose={() => setEditingRunId(null)}
          />
        )
      })()}

      {pendingDeleteId && (
        <ConfirmDialog
          message="このランを削除しますか？"
          confirmLabel="削除"
          destructive
          onConfirm={() => {
            void removeRun(pendingDeleteId)
            setPendingDeleteId(null)
          }}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}

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
      {armed && (
        <div
          ref={movementSelectorRef}
          className="gallery-movement-selector"
          onClick={e => e.stopPropagation()}
        >
          <MovementTypeSelector value={movementType} onChange={setMovementType} />
        </div>
      )}
      {armed && <div ref={startLabelRef} className="start-label">TAP TO START</div>}
      {armed && user && (
        <button
          ref={coRunEntryRef}
          type="button"
          className="co-run-entry-btn"
          onClick={(e) => {
            e.stopPropagation()
            useCoRunStore.getState().openPicker()
          }}
          aria-label="友達と走る"
        >
          <span className="co-run-entry-icon">
            <Icon icon="lucide:user-plus" />
          </span>
          <span className="co-run-entry-label">友達と走る</span>
        </button>
      )}

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
            <span className="fab-icon" style={{ width: eyeParams.fabIconSize, height: eyeParams.fabIconSize }}><EyesIcon blinkSignal={blinkSignal} params={eyeParams} /></span>
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
            className={`profile-btn${view === 'profile' ? ' is-active' : ''}`}
            onClick={() => toggleView('profile')}
            aria-label={view === 'profile' ? 'プロフィールを閉じる' : 'プロフィールを開く'}
            title="プロフィール"
          >
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt=""
                className="profile-btn-avatar"
                referrerPolicy="no-referrer"
              />
            ) : (
              <Icon icon="lucide:user" />
            )}
          </button>
        </div>
      </div>

      {showFirstRunIntro && <FirstRunIntro onDismiss={dismissFirstRunIntro} />}
    </div>
  )
}
