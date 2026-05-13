import { useRef, useState, useCallback } from 'react'
import type { TrackPoint, Note } from '../types'
import { qualifyAltitude } from '../utils/geoUtils'
import { applyFilters, defaultFilters, type PointFilter } from '../utils/recordingFilters'
import { startLocationSubscription, type LocationUnsubscribe } from '../utils/locationSource'
import {
  initKalmanGps,
  kalmanCheck,
  DEFAULT_KALMAN_CONFIG,
  type KalmanGpsConfig,
  type KalmanGpsState,
} from '../utils/kalmanGps'

interface GpsRecorderState {
  isRecording: boolean
  trackPoints: TrackPoint[]
  error: string | null
  consecutiveRejections: number
  /** 直近の Kalman ゲート評価値 (採用/棄却どちらでも更新)。診断用。 */
  lastMahalanobis2: number | null
}

export function useGpsRecorder(
  filters: PointFilter[] = defaultFilters(),
  kalmanConfig: KalmanGpsConfig | null = DEFAULT_KALMAN_CONFIG,
) {
  const [state, setState] = useState<GpsRecorderState>({
    isRecording: false,
    trackPoints: [],
    error: null,
    consecutiveRejections: 0,
    lastMahalanobis2: null,
  })
  const unsubscribeRef = useRef<LocationUnsubscribe | null>(null)
  const recordingStartedAtRef = useRef<number>(0)
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const kalmanConfigRef = useRef(kalmanConfig)
  kalmanConfigRef.current = kalmanConfig
  const kalmanStateRef = useRef<KalmanGpsState | null>(null)

  const start = useCallback(async () => {
    recordingStartedAtRef.current = Date.now()
    kalmanStateRef.current = null
    setState(s => ({
      ...s,
      isRecording: true,
      error: null,
      consecutiveRejections: 0,
      lastMahalanobis2: null,
    }))

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
            barometricAltitude: reading.barometricAltitude,
            barometricKind: reading.barometricKind,
            barometricAccuracy: reading.barometricAccuracy,
            barometricPrecision: reading.barometricPrecision,
          }
          setState(s => {
            const accepted = s.trackPoints.filter(p => !p.rejected)
            const ctx = {
              history: accepted,
              recordingStartedAt: recordingStartedAtRef.current,
            }
            const preOk = applyFilters(point, ctx, filtersRef.current)

            let ok = preOk
            let mahalanobis2: number | null = null
            if (preOk && kalmanConfigRef.current) {
              const kState = kalmanStateRef.current
              if (!kState) {
                // 最初の採用点で Kalman を初期化。初期化点は無条件採用。
                kalmanStateRef.current = initKalmanGps(point, kalmanConfigRef.current)
              } else {
                const r = kalmanCheck(kState, point, kalmanConfigRef.current)
                mahalanobis2 = r.mahalanobis2
                if (r.ok && r.next) {
                  kalmanStateRef.current = r.next
                } else {
                  ok = false
                }
              }
            }

            const tagged: TrackPoint = ok ? point : { ...point, rejected: true }
            return {
              ...s,
              trackPoints: [...s.trackPoints, tagged],
              consecutiveRejections: ok ? 0 : s.consecutiveRejections + 1,
              lastMahalanobis2: mahalanobis2 ?? s.lastMahalanobis2,
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
