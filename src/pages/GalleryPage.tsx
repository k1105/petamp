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
import { expandBboxByMeters } from '../utils/runBbox'
import { groupRunsByBboxOverlap, pickInitialGroup } from '../utils/runGroups'
import { useRunStore } from '../store/useRunStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { SettingsPanel } from '../components/gallery/SettingsPanel'
import { RunTile } from '../components/gallery/RunTile'
import { EyesIcon } from '../components/gallery/EyesIcon'
import { getTubeMesh } from '../utils/tubeMesh'
import { acceptedPoints } from '../utils/recordingFilters'
import { useGalleryAnimation } from '../hooks/useGalleryAnimation'
import { useCurrentPosition } from '../hooks/useCurrentPosition'
import { useMetaballSheet } from '../hooks/useMetaballSheet'
import { useTransitionStore } from '../store/useTransitionStore'
import type { DotPosition } from '../hooks/useGalleryAnimation'
import type { Run } from '../types'

const sphere = new SphereGeometry({ radius: 1, nlat: 20, nlong: 20 })
const MIN_ZOOM = 12.5
const SPHERE_REF_ZOOM = 13

function GalleryLayers({ runs, dots }: { runs: Run[]; dots: DotPosition[] }) {
  const zoom = useMapZoom()
  const navigate = useNavigate()
  const radii = useSettingsStore(s => s.radii)

  const t = Math.max(0, Math.min(1, (zoom - (MIN_ZOOM - 0.5)) / 0.5))
  const tubeColor: [number, number, number, number] = [160, 160, 160, Math.round(255 * t)]
  const dotColor: [number, number, number, number] = [28, 151, 94, Math.round(255 * t)]
  const mat = { ambient: 1, diffuse: 0, shininess: 0, specularColor: [0, 0, 0] as [number, number, number] }

  const sphereRadius = Math.min(
    radii.dotRadius * Math.pow(2, SPHERE_REF_ZOOM - zoom),
    radii.dotRadius
  )

  const layers = useMemo(() => {
    if (t === 0) return []
    const tubeLayers: SimpleMeshLayer[] = []
    for (const run of runs) {
      const pts = acceptedPoints(run.trackPoints)
      const mesh = getTubeMesh(run.id, pts, radii.tubeRadius)
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
    ]
  }, [runs, dots, t, sphereRadius, radii.tubeRadius])

  return <DeckOverlay layers={layers} />
}

// Mock phrases for the armed-state speech bubble. Will be replaced by
// local-LLM generation later; for now a fixed pool that cycles on tap.
const SPEECH_PHRASES = [
  'このへんは初めてだ',
  'ホームグラウンド！',
  '今日はさかみちある？',
] as const

function pickPhrase(current: string | null): string {
  const others = SPEECH_PHRASES.filter(p => p !== current)
  return others[Math.floor(Math.random() * others.length)]
}

export function GalleryPage() {
  const { runs, loadRuns, removeRun } = useRunStore()
  const ui = useSettingsStore(s => s.ui)
  const [listOpen, setListOpen] = useState(false)
  const [armed, setArmed] = useState(false)
  const [sheetView, setSheetView] = useState<'list' | 'settings'>('list')
  const [bubblePhrase, setBubblePhrase] = useState<string | null>(null)
  const dots = useGalleryAnimation(runs)
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

  // Phase 2: cluster runs into groups and pick a current group. The map is
  // constrained to the selected group's bbox; switching groups updates the
  // constraint (Phase 3 will add the swipe/tap UI; for now we lock to the
  // initial selection — the group containing the user's current GPS, falling
  // back to the first group).
  const groups = useMemo(
    () => groupRunsByBboxOverlap(runs, ui.mapPaddingMeters),
    [runs, ui.mapPaddingMeters],
  )
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null)
  useEffect(() => {
    if (!runsLoaded) return
    if (currentGroupId && groups.some(g => g.id === currentGroupId)) return
    const initial = pickInitialGroup(groups, initialCenter ?? null)
    setCurrentGroupId(initial?.id ?? null)
  }, [runsLoaded, groups, currentGroupId, initialCenter])

  const currentGroup = useMemo(
    () => groups.find(g => g.id === currentGroupId) ?? null,
    [groups, currentGroupId],
  )

  // initialBounds for BaseMap mount — derived from the selected group's bbox.
  const initialBounds = useMemo(() => {
    if (!runsLoaded || !currentGroup) return undefined
    return expandBboxByMeters(currentGroup.bbox, ui.mapPaddingMeters) as [[number, number], [number, number]]
  }, [runsLoaded, currentGroup, ui.mapPaddingMeters])

  useEffect(() => {
    if (armed) setBubblePhrase(pickPhrase(null))
    else setBubblePhrase(null)
  }, [armed])

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
    } else {
      setArmed(true)
      setListOpen(false)
    }
  }

  return (
    <div className="page">
      <div className="map-container">
        {initialCenter !== undefined && runsLoaded && (
          <BaseMap
            initialCenter={initialCenter ?? undefined}
            initialZoom={13}
            initialBounds={initialBounds}
          >
            <GalleryLayers runs={runs} dots={dots} />
            <AreaLabel />
            <MapBoundsConstraint bbox={currentGroup?.bbox ?? null} paddingMeters={ui.mapPaddingMeters} />
            <GroupNavigation
              currentGroup={currentGroup}
              groups={groups}
              paddingMeters={ui.mapPaddingMeters}
              onGroupChange={setCurrentGroupId}
            />
          </BaseMap>
        )}
      </div>

      {armed && <div className="armed-backdrop" onClick={() => setArmed(false)} />}
      {armed && bubblePhrase && (
        <button
          ref={speechBubbleRef}
          key={bubblePhrase}
          className="speech-bubble"
          onClick={(e) => {
            e.stopPropagation()
            setBubblePhrase(prev => pickPhrase(prev))
          }}
          aria-label={`発話: ${bubblePhrase} (タップで切替)`}
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
