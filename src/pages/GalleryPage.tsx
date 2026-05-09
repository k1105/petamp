import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { SphereGeometry, CylinderGeometry } from '@luma.gl/engine'
import { Icon } from '@iconify/react'
import { BaseMap, useMapZoom } from '../components/map/BaseMap'
import { DeckOverlay } from '../components/map/DeckOverlay'
import { AreaLabel } from '../components/map/AreaLabel'
import { useRunStore } from '../store/useRunStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { SettingsPanel } from '../components/gallery/SettingsPanel'
import { RunTile } from '../components/gallery/RunTile'
import { EyesIcon } from '../components/gallery/EyesIcon'
import { buildTubeSegments, buildTubeJoints } from '../utils/tubeData'
import { acceptedPoints } from '../utils/recordingFilters'
import { useGalleryAnimation } from '../hooks/useGalleryAnimation'
import { useCurrentPosition } from '../hooks/useCurrentPosition'
import { useMetaballSheet } from '../hooks/useMetaballSheet'
import type { DotPosition } from '../hooks/useGalleryAnimation'
import type { Run } from '../types'

const sphere = new SphereGeometry({ radius: 1, nlat: 20, nlong: 20 })
const cylinder = new CylinderGeometry({ radius: 1, height: 1, nradial: 12 })
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
    return [
      ...runs.flatMap(run => {
        const pts = acceptedPoints(run.trackPoints)
        return [
          new SimpleMeshLayer({
            id: `run-tube-${run.id}`,
            data: buildTubeSegments(pts, radii.tubeRadius),
            mesh: cylinder,
            getPosition: d => d.position,
            getScale: d => d.scale,
            getOrientation: d => d.orientation,
            getColor: tubeColor,
            material: mat,
            pickable: true,
            onClick: () => { navigate(`/run/${run.id}`) },
          }),
          new SimpleMeshLayer({
            id: `run-joints-${run.id}`,
            data: buildTubeJoints(pts, radii.tubeRadius),
            mesh: sphere,
            getPosition: d => d.position,
            getScale: d => d.scale,
            getColor: tubeColor,
            material: mat,
          }),
        ]
      }),
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

export function GalleryPage() {
  const navigate = useNavigate()
  const { runs, loadRuns, removeRun } = useRunStore()
  const ui = useSettingsStore(s => s.ui)
  const [listOpen, setListOpen] = useState(false)
  const [armed, setArmed] = useState(false)
  const [sheetView, setSheetView] = useState<'list' | 'settings'>('list')
  const dots = useGalleryAnimation(runs)
  const initialCenter = useCurrentPosition()
  const [searchParams] = useSearchParams()
  const isDebug = searchParams.get('debug') === '1'

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  useMetaballSheet({ canvasRef, sheetRef, fabRef })

  useEffect(() => { loadRuns(isDebug) }, [isDebug])

  const handleFabClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (armed) {
      navigate('/record')
    } else {
      setArmed(true)
      setListOpen(false)
    }
  }

  return (
    <div className="page">
      <div className="map-container">
        {initialCenter !== undefined && (
          <BaseMap initialCenter={initialCenter ?? undefined} initialZoom={13}>
            <GalleryLayers runs={runs} dots={dots} />
            <AreaLabel />
          </BaseMap>
        )}
      </div>

      {armed && <div className="armed-backdrop" onClick={() => setArmed(false)} />}

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
            aria-label={armed ? 'START' : '記録開始'}
          >
            <span className="fab-icon" style={{ width: ui.fabIconSize, height: ui.fabIconSize }}><EyesIcon /></span>
            {armed && <span className="fab-label">START</span>}
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
              <RunTile key={run.id} run={run} onDelete={removeRun} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
