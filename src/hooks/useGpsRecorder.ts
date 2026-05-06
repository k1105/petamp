import { useRef, useState, useCallback } from 'react'
import type { TrackPoint, Note } from '../types'
import { qualifyAltitude } from '../utils/geoUtils'

interface GpsRecorderState {
  isRecording: boolean
  trackPoints: TrackPoint[]
  error: string | null
}

export function useGpsRecorder() {
  const [state, setState] = useState<GpsRecorderState>({
    isRecording: false,
    trackPoints: [],
    error: null,
  })
  const watchIdRef = useRef<number | null>(null)

  const start = useCallback(() => {
    if (!navigator.geolocation) {
      setState(s => ({ ...s, error: '位置情報がサポートされていません' }))
      return
    }
    setState(s => ({ ...s, isRecording: true, trackPoints: [], error: null }))

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, altitude, altitudeAccuracy, accuracy } = pos.coords
        const point: TrackPoint = {
          lat: latitude,
          lng: longitude,
          altitude: qualifyAltitude(altitude, altitudeAccuracy),
          altitudeAccuracy: altitudeAccuracy,
          timestamp: pos.timestamp,
          accuracy,
        }
        setState(s => ({ ...s, trackPoints: [...s.trackPoints, point] }))
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
