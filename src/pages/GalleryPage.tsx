import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers'
import { Icon } from '@iconify/react'
import { BaseMap } from '../components/map/BaseMap'
import { useMap, useMapZoom } from '../components/map/MapContext'
import { DeckOverlay } from '../components/map/DeckOverlay'
import { AreaLabel } from '../components/map/AreaLabel'
import { NowPlayingLabel } from '../components/map/NowPlayingLabel'
import { MapBoundsConstraint } from '../components/map/MapBoundsConstraint'
import { GroupEdgeIndicator } from '../components/map/GroupEdgeIndicator'
import { expandBboxByMeters } from '../utils/runBbox'
import { groupRunsByBboxOverlap, makeHomeGroup, findGroupContaining } from '../utils/runGroups'
import { useRunStore } from '../store/useRunStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useSocialFeedStore } from '../store/useSocialFeedStore'
import { SettingsPopup } from '../components/gallery/SettingsPopup'
import { ProfileScreen } from '../components/ProfileScreen'
import { useAuth } from '../hooks/useAuth'
import { RunTile } from '../components/gallery/RunTile'
import { CoRunTile } from '../components/gallery/CoRunTile'
import { EyesIcon } from '../components/gallery/EyesIcon'
import { useEyeParams } from '../hooks/useEyeParams'
import { IslandView } from '../components/island/IslandView'
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
import { useJoystickStore } from '../store/useJoystickStore'
import { useTransitionStore } from '../store/useTransitionStore'
import { useCoRunStore } from '../store/useCoRunStore'
import { useNamedPlaces } from '../hooks/useNamedPlaces'
import type { DotPosition } from '../hooks/useGalleryAnimation'
import type { Run } from '../types'
import type { NamedPlace } from '../character/domain/memory'

const MIN_ZOOM = 12.5

const NAMED_PLACE_COLOR_LINE: [number, number, number, number] = [255, 200, 60, 230]
const NAMED_PLACE_COLOR_DOT: [number, number, number, number] = [255, 200, 60, 255]
const NAMED_PLACE_COLOR_DOT_OUTLINE: [number, number, number, number] = [60, 40, 0, 255]

function buildNamedPlaceLayers(
  places: NamedPlace[],
  onPick: (place: NamedPlace) => void,
) {
  if (places.length === 0) return []
  const layers = []
  const segs = places.filter(p => p.polyline && p.polyline.length >= 2)
  if (segs.length > 0) {
    layers.push(
      new PathLayer<NamedPlace>({
        id: 'gallery-named-place-segment',
        data: segs,
        getPath: d => (d.polyline ?? []).map(n => [n.lng, n.lat] as [number, number]),
        getColor: NAMED_PLACE_COLOR_LINE,
        getWidth: 6,
        widthUnits: 'meters',
        widthMinPixels: 2,
        capRounded: true,
        jointRounded: true,
        pickable: true,
        onClick: info => { if (info.object) onPick(info.object as NamedPlace) },
        parameters: { depthCompare: 'always' },
      }),
    )
  }
  const pts = places.filter(p => p.point)
  if (pts.length > 0) {
    layers.push(
      new ScatterplotLayer<NamedPlace>({
        id: 'gallery-named-place-point',
        data: pts,
        getPosition: d => [d.point!.lng, d.point!.lat],
        getRadius: 6,
        radiusUnits: 'meters',
        radiusMinPixels: 4,
        getFillColor: NAMED_PLACE_COLOR_DOT,
        getLineColor: NAMED_PLACE_COLOR_DOT_OUTLINE,
        getLineWidth: 0.8,
        lineWidthUnits: 'meters',
        stroked: true,
        pickable: true,
        onClick: info => { if (info.object) onPick(info.object as NamedPlace) },
        parameters: { depthCompare: 'always' },
      }),
    )
  }
  return layers
}

// FAB タップで現在位置に home スケールでフォーカスする (homeGroup が無い
// = GPS が realGroup 内のケース用)。signal を increment するたびに flyTo。
type Padding = { top: number; bottom: number; left: number; right: number }

function FocusGPS({
  signal,
  center,
  zoom,
  padding,
}: {
  signal: number
  center: [number, number] | null
  zoom: number
  // 現在位置を画面中心ではなく petamp の顔(FAB)の位置に表示するための padding。
  // padding は viewport を縮めて光学的中心をずらすため、maxBounds 下でも focal point を寄せられる。
  padding: Padding
}) {
  const { map } = useMap()
  const lastRef = useRef(0)
  useEffect(() => {
    if (!map || !center || signal === 0 || signal === lastRef.current) return
    lastRef.current = signal
    map.flyTo({ center, zoom, padding, duration: 700 })
  }, [signal, map, center, zoom, padding])
  return null
}

function GalleryLayers({
  runs,
  dots,
  namedPlaces,
  onPickPlace,
}: {
  runs: Run[]
  dots: DotPosition[]
  namedPlaces: NamedPlace[]
  onPickPlace: (place: NamedPlace) => void
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
    // NamedPlace の point/segment レイヤ。クリックで onPickPlace(place) を呼んで
    // ポップアップを開く。地形の上に乗せたいので depthCompare 無効化。
    const placeLayers = buildNamedPlaceLayers(namedPlaces, onPickPlace)
    return [tubeLayer, dotsLayer, ...placeLayers]
  }, [runPaths, dots, t, dotRadius, tubeWidth, tubeColor, dotColor, navigate, namedPlaces, onPickPlace])

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

  // TRAIL 一覧用の表示単位。一緒に走ったラン (同一 coRunSessionId) は
  // 自分 + 相手をまとめて 1 つの co-run アイテムに統合する。
  type ListItem =
    | { kind: 'single'; run: Run }
    | { kind: 'corun'; sessionId: string; runs: Run[] }
  const listItems = useMemo<ListItem[]>(() => {
    const items: ListItem[] = []
    const seenSessions = new Set<string>()
    for (const run of socialRuns) {
      const sid = run.coRunSessionId
      if (sid) {
        if (seenSessions.has(sid)) continue
        seenSessions.add(sid)
        items.push({
          kind: 'corun',
          sessionId: sid,
          runs: socialRuns.filter(r => r.coRunSessionId === sid),
        })
      } else {
        items.push({ kind: 'single', run })
      }
    }
    return items
  }, [socialRuns])
  const [view, setView] = useState<'map' | 'list' | 'profile'>('map')
  const [listMode, setListMode] = useState<'trail' | 'island'>('trail')
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

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const speechBubbleRef = useRef<HTMLButtonElement>(null)
  const startLabelRef = useRef<HTMLDivElement>(null)
  const coRunEntryRef = useRef<HTMLButtonElement>(null)
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
    if (!activeBubbleText && !armed) return
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
          // ペタンプの顔(FAB)の右隣に「友達と走る」アイコン+ラベルを縦中央で並べる。
          const coRun = coRunEntryRef.current
          if (coRun) {
            coRun.style.left = `${r.right + 14}px`
            coRun.style.top = `${r.top + r.height / 2 - coRun.offsetHeight / 2}px`
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
    <div className="page">
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
        {initialCenter !== undefined && runsLoaded && (
          <BaseMap
            initialCenter={initialCenter ?? undefined}
            initialZoom={HOME_FIXED_ZOOM}
            initialBounds={initialBounds}
          >
            <GalleryLayers
              runs={runs}
              dots={dots}
              namedPlaces={namedPlaces}
              onPickPlace={setSelectedPlace}
            />
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
              </div>
            </div>
            {socialRuns.length === 0 ? (
              <p className="empty-hint">記録したランがここに表示されます</p>
            ) : listMode === 'trail' ? (
              <div className="run-grid">
                {listItems.map(item =>
                  item.kind === 'single' ? (
                    <RunTile
                      key={item.run.id}
                      run={item.run}
                      owner={item.run.ownerUid ? ownerByUid.get(item.run.ownerUid) ?? null : null}
                      onDelete={removeRun}
                      onSelect={handleRunSelect}
                    />
                  ) : (
                    <CoRunTile
                      key={item.sessionId}
                      runs={item.runs}
                      ownerByUid={ownerByUid}
                      onSelect={handleRunSelect}
                    />
                  ),
                )}
              </div>
            ) : (
              <div className="island-view-wrap">
                <IslandView
                  layout={archLayout}
                  loading={archLoading}
                  socialRuns={socialRuns}
                  ownerByUid={ownerByUid}
                />
              </div>
            )}
          </>
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

function NamedPlacePopup({ place, onClose }: { place: NamedPlace; onClose: () => void }) {
  const desc = (place.description ?? '').trim()
  return (
    <div className="named-place-popup" role="dialog" aria-label={`${place.name} の説明`}>
      <button
        type="button"
        className="named-place-popup-close"
        onClick={onClose}
        aria-label="閉じる"
      >
        ×
      </button>
      <div className="named-place-popup-name">{place.name}</div>
      <div className="named-place-popup-desc">
        {desc !== '' ? desc : '(まだ言葉になっていない場所)'}
      </div>
    </div>
  )
}
