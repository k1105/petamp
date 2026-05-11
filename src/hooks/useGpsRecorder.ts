import { useRef, useState, useCallback } from 'react'
import type { TrackPoint, Note } from '../types'
import { qualifyAltitude } from '../utils/geoUtils'
import { applyFilters, defaultFilters, type PointFilter } from '../utils/recordingFilters'

interface GpsRecorderState {
  isRecording: boolean
  trackPoints: TrackPoint[]
  error: string | null
  consecutiveRejections: number
}

const RECOVERY_AFTER_REJECTIONS = 3
const HARD_ACCURACY_MAX_METERS = 25

export function useGpsRecorder(filters: PointFilter[] = defaultFilters()) {
  const [state, setState] = useState<GpsRecorderState>({
    isRecording: false,
    trackPoints: [],
    error: null,
    consecutiveRejections: 0,
  })
  const watchIdRef = useRef<number | null>(null)
  const recordingStartedAtRef = useRef<number>(0)
  const filtersRef = useRef(filters)
  filtersRef.current = filters

  const start = useCallback(() => {
    if (!navigator.geolocation) {
      setState(s => ({ ...s, error: '位置情報がサポートされていません' }))
      return
    }
    recordingStartedAtRef.current = Date.now()
    setState(s => ({ ...s, isRecording: true, error: null, consecutiveRejections: 0 }))

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, altitude, altitudeAccuracy, accuracy, heading } = pos.coords
        const point: TrackPoint = {
          lat: latitude,
          lng: longitude,
          altitude: qualifyAltitude(altitude, altitudeAccuracy),
          altitudeAccuracy: altitudeAccuracy,
          timestamp: pos.timestamp,
          accuracy,
          heading: heading != null && !Number.isNaN(heading) ? heading : null,
        }
        setState(s => {
          const accepted = s.trackPoints.filter(p => !p.rejected)
          const ctx = {
            history: accepted,
            recordingStartedAt: recordingStartedAtRef.current,
          }
          const passes = applyFilters(point, ctx, filtersRef.current)

          // 連続棄却から回復: filterで弾かれてもN回連続したら強制採用してbaselineをリセット
          // ただし accuracy が閾値を超える点は強制採用しない
          const accuracyOk = point.accuracy != null && point.accuracy <= HARD_ACCURACY_MAX_METERS
          let ok = passes
          let nextConsecutive = passes ? 0 : s.consecutiveRejections + 1
          if (!passes && accuracyOk && s.consecutiveRejections + 1 >= RECOVERY_AFTER_REJECTIONS) {
            ok = true
            nextConsecutive = 0
          }

          const tagged: TrackPoint = ok ? point : { ...point, rejected: true }
          return {
            ...s,
            trackPoints: [...s.trackPoints, tagged],
            consecutiveRejections: nextConsecutive,
          }
        })
      },
      (err) => {
        setState(s => ({ ...s, error: err.message }))
      },
      { enableHighAccuracy: true, maximumAge: 0 },
    )
  }, [])

  const stop = useCallback((): TrackPoint[] => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    setState(s => ({ ...s, isRecording: false }))
    return state.trackPoints
  }, [state.trackPoints])

  const addNote = useCallback((noteData: Omit<Note, 'id' | 'timestamp'>): Note => {
    const note: Note = {
      ...noteData,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    }
    return note
  }, [])

  return { ...state, start, stop, addNote }
}
