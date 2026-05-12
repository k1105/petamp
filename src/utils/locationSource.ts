import { Capacitor, registerPlugin } from '@capacitor/core'
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation'

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')

export interface LocationReading {
  lat: number
  lng: number
  altitude: number | null
  altitudeAccuracy: number | null
  accuracy: number | null
  heading: number | null
  timestamp: number
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
        onReading({
          lat: location.latitude,
          lng: location.longitude,
          altitude: location.altitude,
          altitudeAccuracy: location.altitudeAccuracy,
          accuracy: location.accuracy,
          heading: location.bearing,
          timestamp: location.time ?? Date.now(),
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
      })
    },
    (err) => onError({ message: err.message }),
    { enableHighAccuracy: true, maximumAge: 0 },
  )
  return async () => {
    navigator.geolocation.clearWatch(watchId)
  }
}
