import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { SphereGeometry, CylinderGeometry } from '@luma.gl/engine'
import { Icon } from '@iconify/react'
import { BaseMap, useMap, useMapZoom } from '../components/map/BaseMap'
import { DeckOverlay } from '../components/map/DeckOverlay'
import { LiveStats } from '../components/recording/LiveStats'
import { PathDebugPanel } from '../components/recording/PathDebugPanel'
import { useGpsRecorder } from '../hooks/useGpsRecorder'
import { useCurrentPosition } from '../hooks/useCurrentPosition'
import { useRunStore } from '../store/useRunStore'
import { buildTubeSegments, buildTubeJoints } from '../utils/tubeData'
import dummyTrackPoints from '../utils/dummyTrackPoints.json'
import type { Run, TrackPoint } from '../types'

const sphere = new SphereGeometry({ radius: 1, nlat: 20, nlong: 20 })
const cylinder = new CylinderGeometry({ radius: 1, height: 1, nradial: 12 })
const TUBE_RADIUS = 3
const MIN_ZOOM = 12.5

function GeolocateTracker() {
  const { map } = useMap()

  useEffect(() => {
    if (!map) return
    const ctrl = new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserLocation: false,
      showAccuracyCircle: false,
    })
    map.addControl(ctrl)
    // マップロード済みなので即時トリガー
    const triggerTimer = window.setTimeout(() => ctrl.trigger(), 100)
    return () => {
      window.clearTimeout(triggerTimer)
      try {
        map.removeControl(ctrl)
      } catch (e) {
        console.warn('GeolocateControl removeControl failed', e)
      }
    }
  }, [map])

  return null
}

function RecordingLayers({
  trackPoints,
  fallbackPosition,
}: {
  trackPoints: TrackPoint[]
  fallbackPosition: [number, number] | null
}) {
  const zoom = useMapZoom()
  const t = Math.max(0, Math.min(1, (zoom - (MIN_ZOOM - 0.5)) / 0.5))

  const tubeData = useMemo(() => buildTubeSegments(trackPoints, TUBE_RADIUS), [trackPoints])
  const jointData = useMemo(() => buildTubeJoints(trackPoints, TUBE_RADIUS), [trackPoints])
  const dotData = useMemo(() => {
    const last = trackPoints.at(-1)
    const pos: [number, number] | null = last ? [last.lng, last.lat] : fallbackPosition
    return pos ? [{ position: pos }] : []
  }, [trackPoints, fallbackPosition])

  const tubeColor: [number, number, number, number] = [160, 160, 160, Math.round(255 * t)]
  const dotColor: [number, number, number, number] = [28, 151, 94, Math.round(255 * t)]
  const mat = { ambient: 1, diffuse: 0, shininess: 0, specularColor: [0, 0, 0] as [number, number, number] }

  const layers = useMemo(() => {
    if (t === 0) return []
    return [
      new SimpleMeshLayer({
        id: 'live-tube',
        data: tubeData,
        mesh: cylinder,
        getPosition: d => d.position,
        getScale: d => d.scale,
        getOrientation: d => d.orientation,
        getColor: tubeColor,
        material: mat,
      }),
      new SimpleMeshLayer({
        id: 'live-joints',
        data: jointData,
        mesh: sphere,
        getPosition: d => d.position,
        getScale: d => d.scale,
        getColor: tubeColor,
        material: mat,
      }),
      new SimpleMeshLayer({
        id: 'live-dot',
        data: dotData,
        mesh: sphere,
        getPosition: (d: { position: [number, number] }) => [d.position[0], d.position[1], 0] as [number, number, number],
        getScale: [TUBE_RADIUS * 1.5, TUBE_RADIUS * 1.5, TUBE_RADIUS * 1.5],
        getColor: dotColor,
        material: mat,
      }),
    ]
  }, [tubeData, jointData, dotData, t])

  return <DeckOverlay layers={layers} />
}

export function RecordingPage() {
  const navigate = useNavigate()
  const { isRecording, trackPoints, error, start, stop } = useGpsRecorder()
  const { addRun } = useRunStore()
  const [debugPoints, setDebugPoints] = useState<TrackPoint[] | null>(null)
  const initialCenter = useCurrentPosition()

  const handleStart = () => {
    start()
  }

  const handleStop = () => {
    stop()
  }

  const handleFinish = () => {
    setDebugPoints(dummyTrackPoints as TrackPoint[])
  }

  const handleProceed = async () => {
    const points = debugPoints
    if (!points || points.length === 0) {
      navigate('/')
      return
    }
    const run: Run = {
      id: crypto.randomUUID(),
      name: `ラン ${new Date().toLocaleDateString('ja-JP')}`,
      startedAt: points[0].timestamp,
      finishedAt: points.at(-1)!.timestamp,
      trackPoints: points,
      notes: [],
    }
    await addRun(run)
    navigate(`/run/${run.id}`)
  }

  const handleCancelDebug = () => {
    setDebugPoints(null)
  }

  return (
    <div className="page">
      <div className="map-container">
        {initialCenter !== undefined && (
          <BaseMap initialCenter={initialCenter ?? undefined}>
            <GeolocateTracker />
            <RecordingLayers
              trackPoints={trackPoints}
              fallbackPosition={initialCenter ?? null}
            />
          </BaseMap>
        )}
      </div>

      <div className="bottom-bar">
        {error && <div className="error-banner">{error}</div>}
        <LiveStats trackPoints={trackPoints} />
        <div className="bottom-bar-actions">
          {!isRecording && (
            <button className="btn-ghost" onClick={() => navigate('/')}>
              <Icon icon="lucide:x" />
              <span>キャンセル</span>
            </button>
          )}
          <button
            className={`record-btn ${isRecording ? 'record-btn-stop' : ''}`}
            onClick={isRecording ? handleStop : handleStart}
          >
            <span className="fab-icon"><Icon icon={isRecording ? 'lucide:square' : 'lucide:circle-dot'} /></span>
            <span className="fab-label">{isRecording ? '停止' : '開始'}</span>
          </button>
          {!isRecording && (
            <button className="finish-btn" onClick={handleFinish}>
              <Icon icon="lucide:flag" />
              <span>FINISH</span>
            </button>
          )}
        </div>
      </div>

      {debugPoints !== null && (
        <PathDebugPanel
          trackPoints={debugPoints}
          onProceed={handleProceed}
          onCancel={handleCancelDebug}
        />
      )}
    </div>
  )
}
