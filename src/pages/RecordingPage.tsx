import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import { PathLayer } from '@deck.gl/layers'
import { BaseMap, useMap } from '../components/map/BaseMap'
import { DeckOverlay } from '../components/map/DeckOverlay'
import { LiveStats } from '../components/recording/LiveStats'
import { useGpsRecorder } from '../hooks/useGpsRecorder'
import { useRunStore } from '../store/useRunStore'
import { buildPathLayerData } from '../utils/pathLayerData'
import type { Run } from '../types'

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
    setTimeout(() => ctrl.trigger(), 100)
    return () => { map.removeControl(ctrl) }
  }, [map])

  return null
}

export function RecordingPage() {
  const navigate = useNavigate()
  const { isRecording, trackPoints, error, start, stop } = useGpsRecorder()
  const { addRun } = useRunStore()
  const handleStart = () => {
    start()
  }

  const handleStop = async () => {
    const points = stop()
    if (points.length === 0) {
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
        <BaseMap>
          <GeolocateTracker />
          <DeckOverlay layers={layers} />
        </BaseMap>
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
        </div>
      </div>
    </div>
  )
}
