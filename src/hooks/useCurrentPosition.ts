import { useEffect, useState } from 'react'

export type CurrentPosition = [number, number] | null

export function useCurrentPosition(): CurrentPosition | undefined {
  const [position, setPosition] = useState<CurrentPosition | undefined>(undefined)

  useEffect(() => {
    if (!navigator.geolocation) {
      setPosition(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => setPosition([pos.coords.longitude, pos.coords.latitude]),
      () => setPosition(null),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }, [])

  return position
}
