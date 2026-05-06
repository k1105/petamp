import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import { PathLayer } from '@deck.gl/layers'
import { BaseMap, useMap } from '../components/map/BaseMap'
import { DeckOverlay } from '../components/map/DeckOverlay'
import { LiveStats } from '../components/recording/LiveStats'
import { PathDebugPanel } from '../components/recording/PathDebugPanel'
import { useGpsRecorder } from '../hooks/useGpsRecorder'
import { useCurrentPosition } from '../hooks/useCurrentPosition'
import { useRunStore } from '../store/useRunStore'
import { buildPathLayerData } from '../utils/pathLayerData'
import dummyTrackPoints from '../utils/dummyTrackPoints.json'
import type { Run, TrackPoint } from '../types'

function GeolocateTracker() {
  const { map } = useMap()

  useEffect(() => {
    if (!map) return
    const ctrl = new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
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

  const layers = [
    new PathLayer({
      id: 'live-path',
      data: buildPathLayerData(trackPoints),
      getPath: d => d,
      getColor: [255, 100, 0],
      getWidth: 4,
      widthMinPixels: 3,
    }),
  ]

  return (
    <div className="page">
      <div className="map-container">
        {initialCenter !== undefined && (
          <BaseMap initialCenter={initialCenter ?? undefined}>
            <GeolocateTracker />
            <DeckOverlay layers={layers} />
          </BaseMap>
        )}
      </div>

      <div className="bottom-bar">
        {error && <div className="error-banner">{error}</div>}
        <LiveStats trackPoints={trackPoints} />
        <div className="bottom-bar-actions">
          {!isRecording && (
            <button className="btn-ghost" onClick={() => navigate('/')}>キャンセル</button>
          )}
          <button
            className={`record-btn ${isRecording ? 'record-btn-stop' : ''}`}
            onClick={isRecording ? handleStop : handleStart}
          >
            <span className="fab-icon">{isRecording ? '■' : '●'}</span>
            <span className="fab-label">{isRecording ? '停止' : '開始'}</span>
          </button>
          {!isRecording && (
            <button className="finish-btn" onClick={handleFinish}>FINISH</button>
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
