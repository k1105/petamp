import { Capacitor, registerPlugin } from '@capacitor/core'
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation'

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')

interface LocationReading {
  lat: number
  lng: number
  altitude: number | null
  altitudeAccuracy: number | null
  accuracy: number | null
  heading: number | null
  timestamp: number
  /** iOS native (CMAltimeter) からのみ得られる気圧高度。Web では常に null。 */
  barometricAltitude: number | null
  barometricKind: 'absolute' | 'relative' | null
  barometricAccuracy: number | null
  barometricPrecision: number | null
}

export type LocationCallback = (reading: LocationReading) => void
export type LocationErrorCallback = (err: { message: string }) => void
export type LocationUnsubscribe = () => Promise<void>

export async function startLocationSubscription(
  onReading: LocationCallback,
  onError: LocationErrorCallback,
): Promise<LocationUnsubscribe> {
  if (Capacitor.isNativePlatform()) {
    const watcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: 'petampが軌跡を記録中',
        backgroundTitle: 'petamp',
        requestPermissions: true,
        stale: false,
        distanceFilter: 0,
      },
      (location, error) => {
        if (error) {
          onError({ message: error.message ?? String(error) })
          return
        }
        if (!location) return
        // BackgroundGeolocationPlugin の型定義には barometric* が無いので unknown 経由でアクセス。
        const native = location as unknown as Record<string, unknown>
        const barometricAltitude = typeof native.barometricAltitude === 'number' ? native.barometricAltitude : null
        const barometricKind =
          native.barometricKind === 'absolute' || native.barometricKind === 'relative' ? native.barometricKind : null
        const barometricAccuracy = typeof native.barometricAccuracy === 'number' ? native.barometricAccuracy : null
        const barometricPrecision = typeof native.barometricPrecision === 'number' ? native.barometricPrecision : null
        onReading({
          lat: location.latitude,
          lng: location.longitude,
          altitude: location.altitude,
          altitudeAccuracy: location.altitudeAccuracy,
          accuracy: location.accuracy,
          heading: location.bearing,
          timestamp: location.time ?? Date.now(),
          barometricAltitude,
          barometricKind,
          barometricAccuracy,
          barometricPrecision,
        })
      },
    )
    return async () => {
      await BackgroundGeolocation.removeWatcher({ id: watcherId })
    }
  }

  if (!navigator.geolocation) {
    onError({ message: '位置情報がサポートされていません' })
    return async () => {}
  }
  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, altitude, altitudeAccuracy, accuracy, heading } = pos.coords
      onReading({
        lat: latitude,
        lng: longitude,
        altitude: altitude ?? null,
        altitudeAccuracy: altitudeAccuracy ?? null,
        accuracy: accuracy ?? null,
        heading: heading != null && !Number.isNaN(heading) ? heading : null,
        timestamp: pos.timestamp,
        // Web Geolocation API には気圧高度の概念が無いので常に null。
        barometricAltitude: null,
        barometricKind: null,
        barometricAccuracy: null,
        barometricPrecision: null,
      })
    },
    (err) => onError({ message: err.message }),
    { enableHighAccuracy: true, maximumAge: 0 },
  )
  return async () => {
    navigator.geolocation.clearWatch(watchId)
  }
}
