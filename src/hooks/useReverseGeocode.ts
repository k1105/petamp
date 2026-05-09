import { useEffect, useState } from 'react'

const cache = new Map<string, string>()

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

export function useReverseGeocode(lng: number | null | undefined, lat: number | null | undefined): string | null {
  const [name, setName] = useState<string | null>(() => lookupCache(lng, lat))

  useEffect(() => {
    if (lng == null || lat == null || !TOKEN) {
      setName(null)
      return
    }

    const key = cacheKey(lng, lat)
    const cached = cache.get(key)
    if (cached !== undefined) {
      setName(cached)
      return
    }

    let cancelled = false
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=place,locality&language=en&access_token=${TOKEN}`
    fetch(url)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const feature = data?.features?.[0]
        const text: string | null = feature?.text ?? null
        cache.set(key, text ?? '')
        setName(text)
      })
      .catch(() => {
        if (!cancelled) setName(null)
      })

    return () => { cancelled = true }
  }, [lng, lat])

  return name
}

function cacheKey(lng: number | null | undefined, lat: number | null | undefined): string {
  if (lng == null || lat == null) return ''
  return `${lng.toFixed(2)},${lat.toFixed(2)}`
}

function lookupCache(lng: number | null | undefined, lat: number | null | undefined): string | null {
  if (lng == null || lat == null) return null
  const v = cache.get(cacheKey(lng, lat))
  return v ? v : null
}
