import { useRef, useState, useCallback } from 'react'
import type { TrackPoint, Note } from '../types'
import { qualifyAltitude } from '../utils/geoUtils'
import { applyFilters, defaultFilters, type PointFilter } from '../utils/recordingFilters'
import { startLocationSubscription, type LocationUnsubscribe } from '../utils/locationSource'

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
  const unsubscribeRef = useRef<LocationUnsubscribe | null>(null)
  const recordingStartedAtRef = useRef<number>(0)
  const filtersRef = useRef(filters)
  filtersRef.current = filters

  const start = useCallback(async () => {
    recordingStartedAtRef.current = Date.now()
    setState(s => ({ ...s, isRecording: true, error: null, consecutiveRejections: 0 }))

    try {
      unsubscribeRef.current = await startLocationSubscription(
        (reading) => {
          const point: TrackPoint = {
            lat: reading.lat,
            lng: reading.lng,
            altitude: qualifyAltitude(reading.altitude, reading.altitudeAccuracy),
            altitudeAccuracy: reading.altitudeAccuracy,
            timestamp: reading.timestamp,
            accuracy: reading.accuracy ?? undefined,
            heading: reading.heading,
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
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setState(s => ({ ...s, isRecording: false, error: message }))
    }
  }, [])

  const stop = useCallback(async (): Promise<TrackPoint[]> => {
    if (unsubscribeRef.current) {
      await unsubscribeRef.current()
      unsubscribeRef.current = null
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
