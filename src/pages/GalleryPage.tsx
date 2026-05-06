import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScatterplotLayer } from '@deck.gl/layers'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { SphereGeometry, CylinderGeometry } from '@luma.gl/engine'
import { BaseMap, useMapZoom } from '../components/map/BaseMap'
import { DeckOverlay } from '../components/map/DeckOverlay'
import { useRunStore } from '../store/useRunStore'
import { RunCard } from '../components/gallery/RunCard'
import { buildTubeSegments, buildTubeJoints } from '../utils/tubeData'
import { useGalleryAnimation } from '../hooks/useGalleryAnimation'
import { useCurrentPosition } from '../hooks/useCurrentPosition'
import type { DotPosition } from '../hooks/useGalleryAnimation'
import type { Run } from '../types'

const TUBE_RADIUS = 3
const sphere = new SphereGeometry({ radius: 1, nlat: 20, nlong: 20 })
const cylinder = new CylinderGeometry({ radius: 1, height: 1, nradial: 12 })
const MIN_ZOOM = 12.5

function GalleryLayers({ runs, dots }: { runs: Run[]; dots: DotPosition[] }) {
  const zoom = useMapZoom()
  const navigate = useNavigate()

  const t = Math.max(0, Math.min(1, (zoom - (MIN_ZOOM - 0.5)) / 0.5))
  const tubeColor: [number, number, number, number] = [160, 160, 160, Math.round(255 * t)]
  const dotColor: [number, number, number, number] = [28, 151, 94, Math.round(255 * t)]
  const mat = { ambient: 1, diffuse: 0, shininess: 0, specularColor: [0, 0, 0] as [number, number, number] }

  const layers = useMemo(() => {
    if (t === 0) return []
    return [
      ...runs.map(run =>
        new ScatterplotLayer({
          id: `run-paint-${run.id}`,
          data: run.trackPoints,
          getPosition: p => [p.lng, p.lat, 0],
          getRadius: 35,
          radiusUnits: 'meters',
          getFillColor: [28, 151, 94, Math.round(22 * t)],
          parameters: { depthTest: false },
        })
      ),
      ...runs.flatMap(run => [
        new SimpleMeshLayer({
          id: `run-tube-${run.id}`,
          data: buildTubeSegments(run.trackPoints, TUBE_RADIUS),
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
          data: buildTubeJoints(run.trackPoints, TUBE_RADIUS),
          mesh: sphere,
          getPosition: d => d.position,
          getScale: d => d.scale,
          getColor: tubeColor,
          material: mat,
        }),
      ]),
      new SimpleMeshLayer({
        id: 'gallery-dots',
        data: dots,
        mesh: sphere,
        getPosition: (d: { position: [number, number] }) => [d.position[0], d.position[1], 0] as [number, number, number],
        getScale: [25, 25, 25],
        getColor: dotColor,
        material: mat,
      }),
    ]
  }, [runs, dots, t])

  return <DeckOverlay layers={layers} />
}

export function GalleryPage() {
  const navigate = useNavigate()
  const { runs, loadRuns, removeRun } = useRunStore()
  const [listOpen, setListOpen] = useState(false)
  const [armed, setArmed] = useState(false)
  const dots = useGalleryAnimation(runs)
  const initialCenter = useCurrentPosition()

  useEffect(() => { loadRuns() }, [])

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
          </BaseMap>
        )}
      </div>

      {armed && <div className="armed-backdrop" onClick={() => setArmed(false)} />}

      <div className={`bottom-sheet ${listOpen ? 'open' : ''} ${armed ? 'armed' : ''}`}>
        <div className="bottom-sheet-shape">
          <div className="bottom-sheet-bg" />
          <button
            className="fab fab-sheet"
            onClick={handleFabClick}
          >
            <span className="fab-icon">●</span>
            {armed && <span className="fab-label">START</span>}
          </button>
        </div>
        <div className="bottom-sheet-handle" onClick={() => setListOpen(v => !v)} />
        {runs.length === 0 ? (
          <p className="empty-hint">記録したランがここに表示されます</p>
        ) : (
          <div className="run-list">
            {runs.map(run => (
              <RunCard key={run.id} run={run} onDelete={removeRun} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
