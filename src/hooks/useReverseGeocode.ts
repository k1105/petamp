import { useEffect, useState } from 'react'

const cache = new Map<string, string>()
const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

function cacheKey(lng: number, lat: number): string {
  return `${lng.toFixed(2)},${lat.toFixed(2)}`
}

export async function fetchAreaName(lng: number, lat: number): Promise<string | null> {
  if (!TOKEN) return null
  const key = cacheKey(lng, lat)
  const cached = cache.get(key)
  if (cached !== undefined) return cached || null

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=place,locality&language=en&access_token=${TOKEN}`
    const res = await fetch(url)
    const data = await res.json()
    const text: string | null = data?.features?.[0]?.text ?? null
    cache.set(key, text ?? '')
    return text
  } catch {
    return null
  }
}

function lookupCache(lng: number | null | undefined, lat: number | null | undefined): string | null {
  if (lng == null || lat == null) return null
  const v = cache.get(cacheKey(lng, lat))
  return v ? v : null
}

export function useReverseGeocode(
  lng: number | null | undefined,
  lat: number | null | undefined,
): string | null {
  const [name, setName] = useState<string | null>(() => lookupCache(lng, lat))

  useEffect(() => {
    if (lng == null || lat == null) {
      setName(null)
      return
    }
    let cancelled = false
    fetchAreaName(lng, lat).then(text => {
      if (!cancelled) setName(text)
    })
    return () => { cancelled = true }
  }, [lng, lat])

  return name
}

export function primeCache(lng: number, lat: number, name: string): void {
  cache.set(cacheKey(lng, lat), name)
}
