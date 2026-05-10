import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { SphereGeometry } from '@luma.gl/engine'
import { Icon } from '@iconify/react'
import { BaseMap, useMapZoom } from '../components/map/BaseMap'
import { DeckOverlay } from '../components/map/DeckOverlay'
import { AreaLabel } from '../components/map/AreaLabel'
import { MapBoundsConstraint } from '../components/map/MapBoundsConstraint'
import { GroupNavigation } from '../components/map/GroupNavigation'
import { GroupEdgeIndicator } from '../components/map/GroupEdgeIndicator'
import { expandBboxByMeters } from '../utils/runBbox'
import { groupRunsByBboxOverlap, makeHomeGroup } from '../utils/runGroups'
import { useRunStore } from '../store/useRunStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { SettingsPanel } from '../components/gallery/SettingsPanel'
import { RunTile } from '../components/gallery/RunTile'
import { EyesIcon } from '../components/gallery/EyesIcon'
import { getTubeMesh } from '../utils/tubeMesh'
import { effectiveRadius, bucketRadius } from '../utils/effectiveRadius'
import { acceptedPoints } from '../utils/recordingFilters'
import { useGalleryAnimation } from '../hooks/useGalleryAnimation'
import { useCurrentPosition } from '../hooks/useCurrentPosition'
import { useHomePhrase } from '../hooks/useHomePhrase'
import { useMetaballSheet } from '../hooks/useMetaballSheet'
import { useTransitionStore } from '../store/useTransitionStore'
import type { DotPosition } from '../hooks/useGalleryAnimation'
import type { Run } from '../types'

const sphere = new SphereGeometry({ radius: 1, nlat: 20, nlong: 20 })
const MIN_ZOOM = 12.5
// 現在位置(=自己位置)dotは過去ランの軌跡dotより少し大きく強調する。
const CURRENT_DOT_SCALE = 1.2

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

  const t = Math.max(0, Math.min(1, (zoom - (MIN_ZOOM - 0.5)) / 0.5))
  const tubeColor: [number, number, number, number] = [160, 160, 160, Math.round(255 * t)]
  const dotColor: [number, number, number, number] = [28, 151, 94, Math.round(255 * t)]
  const mat = { ambient: 1, diffuse: 0, shininess: 0, specularColor: [0, 0, 0] as [number, number, number] }

  const sphereRadius = effectiveRadius(zoom, radii.zoomThreshold, radii.dotRadius)
  const tubeRadius = bucketRadius(
    effectiveRadius(zoom, radii.zoomThreshold, radii.tubeRadius),
  )

  const layers = useMemo(() => {
    if (t === 0) return []
    const tubeLayers: SimpleMeshLayer[] = []
    for (const run of runs) {
      const pts = acceptedPoints(run.trackPoints)
      const mesh = getTubeMesh(run.id, pts, tubeRadius)
      if (!mesh) continue
      tubeLayers.push(new SimpleMeshLayer({
        id: `run-tube-${run.id}`,
        data: [{ position: mesh.anchor }],
        mesh: {
          attributes: {
            POSITION: { value: mesh.positions, size: 3 },
            NORMAL: { value: mesh.normals, size: 3 },
          },
          indices: { value: mesh.indices, size: 1 },
        },
        getPosition: (d: { position: [number, number] }) => [d.position[0], d.position[1], 0] as [number, number, number],
        getColor: tubeColor,
        material: mat,
        pickable: true,
        onClick: () => { navigate(`/run/${run.id}`) },
      }))
    }
    const currentPosLayer = currentPosition
      ? new SimpleMeshLayer({
          id: 'gallery-current-pos',
          // Same sphere asset as /record's live-dot so the visual is identical.
          data: [{ position: currentPosition }],
          mesh: sphere,
          getPosition: (d: { position: [number, number] }) => [d.position[0], d.position[1], 0] as [number, number, number],
          getScale: [sphereRadius * CURRENT_DOT_SCALE, sphereRadius * CURRENT_DOT_SCALE, sphereRadius * CURRENT_DOT_SCALE],
          getColor: [28, 151, 94, 255],
          material: mat,
        })
      : null
    return [
      ...tubeLayers,
      new SimpleMeshLayer({
        id: 'gallery-dots',
        data: dots,
        mesh: sphere,
        getPosition: (d: { position: [number, number] }) => [d.position[0], d.position[1], 0] as [number, number, number],
        getScale: [sphereRadius, sphereRadius, sphereRadius],
        getColor: dotColor,
        material: mat,
      }),
      ...(currentPosLayer ? [currentPosLayer] : []),
    ]
  }, [runs, dots, currentPosition, t, sphereRadius, tubeRadius])

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
  const ui = useSettingsStore(s => s.ui)
  const [listOpen, setListOpen] = useState(false)
  const [armed, setArmed] = useState(false)
  const [sheetView, setSheetView] = useState<'list' | 'settings'>('list')
  const [bubblePhrase, setBubblePhrase] = useState<string | null>(null)
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
  armedRef.current = armed
  useMetaballSheet({ canvasRef, sheetRef, fabRef, armedRef })

  const [runsLoaded, setRunsLoaded] = useState(false)
  useEffect(() => {
    loadRuns(isDebug).finally(() => setRunsLoaded(true))
  }, [isDebug])

  // Phase 2: cluster runs into actual groups.
  const realGroups = useMemo(
    () => groupRunsByBboxOverlap(runs, ui.mapPaddingMeters),
    [runs, ui.mapPaddingMeters],
  )

  // Phase 4: synthesise a "home" pseudo-group at GPS so the initial mount
  // sits at a small fixed cage instead of snapping into a recorded group.
  const homeGroup = useMemo(
    () => (initialCenter ? makeHomeGroup(initialCenter, HOME_HALF_SIZE_METERS) : null),
    [initialCenter],
  )

  // Combined list passed to GroupNavigation — pan-to-edge can move between
  // home and any real group, and between real groups.
  const allGroups = useMemo(
    () => (homeGroup ? [homeGroup, ...realGroups] : realGroups),
    [homeGroup, realGroups],
  )

  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null)
  useEffect(() => {
    if (!runsLoaded) return
    if (currentGroupId && allGroups.some(g => g.id === currentGroupId)) return
    // Default to home when GPS is available; otherwise the first real group.
    setCurrentGroupId(homeGroup ? 'home' : (realGroups[0]?.id ?? null))
  }, [runsLoaded, allGroups, currentGroupId, homeGroup, realGroups])

  const currentGroup = useMemo(
    () => allGroups.find(g => g.id === currentGroupId) ?? null,
    [allGroups, currentGroupId],
  )

  const isHome = currentGroup?.id === 'home'

  // BaseMap initial position. Home: GPS center + fixed zoom (no `bounds`
  // option since we want the explicit fixed scale, not bbox-fit). Real
  // group: padded bbox passed via `bounds` for tight fit.
  const initialBounds = useMemo(() => {
    if (!runsLoaded || !currentGroup || isHome) return undefined
    return expandBboxByMeters(currentGroup.bbox, ui.mapPaddingMeters) as [[number, number], [number, number]]
  }, [runsLoaded, currentGroup, isHome, ui.mapPaddingMeters])

  const homePhrase = useHomePhrase(initialCenter ?? undefined, runs, runsLoaded)

  useEffect(() => {
    if (armed) setBubblePhrase(homePhrase ?? pickFallback())
    else setBubblePhrase(null)
  }, [armed, homePhrase])

  // Position the speech bubble + start label relative to the FAB's actual
  // bounding rect each frame (only while armed). This avoids dvh-based layout
  // jitter on initial load and follows the FAB during its armed transform.
  useEffect(() => {
    if (!armed) return
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
        const label = startLabelRef.current
        if (label) {
          label.style.left = `${cx - label.offsetWidth / 2}px`
          label.style.top = `${r.bottom + 18}px`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [armed, bubblePhrase])

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
    // When the user has navigated to a recorded group, tapping the eye snaps
    // back to home (= focus on current GPS) instead of arming. Arming happens
    // on the next tap once they're at home.
    if (homeGroup && currentGroupId !== 'home') {
      setCurrentGroupId('home')
      return
    }
    setArmed(true)
    setListOpen(false)
  }

  return (
    <div className="page">
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
            <GroupNavigation
              currentGroup={currentGroup}
              groups={allGroups}
              paddingMeters={ui.mapPaddingMeters}
              onGroupChange={setCurrentGroupId}
            />
            <GroupEdgeIndicator
              currentGroup={currentGroup}
              groups={allGroups}
              paddingMeters={ui.mapPaddingMeters}
              onTap={setCurrentGroupId}
            />
          </BaseMap>
        )}
      </div>

      {homeGroup && !armed && (
        <button
          className={`locate-btn${isHome ? ' is-active' : ''}`}
          onClick={() => setCurrentGroupId('home')}
          aria-label="現在位置に戻る"
          title="現在位置に戻る"
        >
          <Icon icon="lucide:locate-fixed" />
        </button>
      )}

      {armed && <div className="armed-backdrop" onClick={() => setArmed(false)} />}
      {armed && bubblePhrase && (
        <button
          ref={speechBubbleRef}
          key={bubblePhrase}
          className="speech-bubble"
          onClick={(e) => e.stopPropagation()}
          aria-label={`発話: ${bubblePhrase}`}
        >
          {bubblePhrase}
        </button>
      )}
      {armed && <div ref={startLabelRef} className="start-label">TAP TO START</div>}
      {listOpen && !armed && (
        <div className="sheet-backdrop" onClick={() => setListOpen(false)} />
      )}

      <canvas ref={canvasRef} className="metaball-canvas" />

      <div ref={sheetRef} className={`bottom-sheet ${listOpen ? 'open' : ''} ${armed ? 'armed' : ''}`}>
        <div className="bottom-sheet-shape">
          <button
            className={`list-toggle-btn${listOpen && sheetView === 'list' ? ' is-active' : ''}`}
            onClick={() => {
              if (listOpen && sheetView === 'list') {
                setListOpen(false)
              } else {
                setSheetView('list')
                setListOpen(true)
              }
            }}
            aria-label={listOpen && sheetView === 'list' ? 'ラン一覧を閉じる' : 'ラン一覧を開く'}
          >
            <Icon icon="lucide:layout-list" />
          </button>
          <button
            ref={fabRef}
            className={`fab fab-sheet${listOpen && !armed ? ` fab-pos-${sheetView}` : ''}`}
            onClick={handleFabClick}
            aria-label={armed ? 'TAP TO START' : '記録開始'}
          >
            <span className="fab-icon" style={{ width: ui.fabIconSize, height: ui.fabIconSize }}><EyesIcon /></span>
          </button>
          <button
            className={`settings-btn${listOpen && sheetView === 'settings' ? ' is-active' : ''}`}
            onClick={() => {
              if (listOpen && sheetView === 'settings') {
                setListOpen(false)
              } else {
                setSheetView('settings')
                setListOpen(true)
              }
            }}
            aria-label={listOpen && sheetView === 'settings' ? '設定を閉じる' : '設定を開く'}
            title="設定"
          >
            <Icon icon="lucide:settings" />
          </button>
        </div>
        <div className="bottom-sheet-handle" onClick={() => setListOpen(v => !v)} />
        {sheetView === 'settings' ? (
          <SettingsPanel />
        ) : runs.length === 0 ? (
          <p className="empty-hint">記録したランがここに表示されます</p>
        ) : (
          <div className="run-grid">
            {runs.map(run => (
              <RunTile key={run.id} run={run} onDelete={removeRun} onSelect={handleRunSelect} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
