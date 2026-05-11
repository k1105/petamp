import { useEffect, useState } from 'react'
import { weatherFromCode, type Weather } from '../utils/themePalettes'

const REFRESH_MS = 30 * 60 * 1000   // 30 分
const CACHE_KEY = 'petamp.weather.cache'

interface CachedWeather {
  weather: Weather
  fetchedAt: number
  lng: number
  lat: number
}

function readCache(): CachedWeather | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as CachedWeather
  } catch {
    return null
  }
}

function writeCache(v: CachedWeather) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}

/**
 * 現在地の天気を Open-Meteo から取得して 3 種に集約して返す。
 * - 30 分以内のキャッシュがあれば再フェッチしない
 * - 取得失敗時は最後のキャッシュ、なければ null
 */
export function useWeather(coords: [number, number] | null | undefined): Weather | null {
  const [weather, setWeather] = useState<Weather | null>(() => readCache()?.weather ?? null)

  useEffect(() => {
    if (!coords) return
    const [lng, lat] = coords
    const cached = readCache()
    const fresh =
      cached &&
      Date.now() - cached.fetchedAt < REFRESH_MS &&
      Math.abs(cached.lng - lng) < 0.1 &&
      Math.abs(cached.lat - lat) < 0.1
    if (fresh) {
      setWeather(cached.weather)
      return
    }

    const ctrl = new AbortController()
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=weather_code`
    void fetch(url, { signal: ctrl.signal })
      .then(r => r.json())
      .then((data: { current?: { weather_code?: number } }) => {
        const code = data.current?.weather_code
        if (typeof code !== 'number') return
        const w = weatherFromCode(code)
        setWeather(w)
        writeCache({ weather: w, fetchedAt: Date.now(), lng, lat })
      })
      .catch(() => {
        /* ネットワーク失敗は無視。前回キャッシュが残っていればそれを使う。 */
      })

    return () => ctrl.abort()
  }, [coords?.[0], coords?.[1]])

  return weather
}
