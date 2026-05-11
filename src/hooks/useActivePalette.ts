import { useEffect, useState } from 'react'
import { useSettingsStore } from '../store/useSettingsStore'
import { useCurrentPosition } from './useCurrentPosition'
import { useWeather } from './useWeather'
import {
  getDefaultPalette,
  getTimeOfDay,
  paletteKey,
  type Palette,
  type TimeOfDay,
  type Weather,
} from '../utils/themePalettes'

export interface ActivePalette {
  weather: Weather
  time: TimeOfDay
  palette: Palette
  autoWeather: Weather | null
  autoTime: TimeOfDay
}

/**
 * 現在適用すべきテーマパレットを返す。
 * - weatherMode === 'auto' なら GPS で取得した天気、それ以外は固定値
 * - timeMode === 'auto' なら現在時刻、それ以外は固定値
 * - overrides で上書きがあればマージ
 */
export function useActivePalette(): ActivePalette {
  const theme = useSettingsStore(s => s.theme)
  const coords = useCurrentPosition()
  const autoWeather = useWeather(theme.weatherMode === 'auto' ? (coords ?? null) : null)

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (theme.timeMode !== 'auto') return
    const i = window.setInterval(() => setNow(new Date()), 60 * 1000)
    return () => window.clearInterval(i)
  }, [theme.timeMode])

  const autoTime = getTimeOfDay(now)
  const weather: Weather = theme.weatherMode !== 'auto' ? theme.weatherMode : (autoWeather ?? 'cloudy')
  const time: TimeOfDay = theme.timeMode !== 'auto' ? theme.timeMode : autoTime

  const def = getDefaultPalette(weather, time)
  const override = theme.overrides[paletteKey(weather, time)] ?? {}
  const palette: Palette = { ...def, ...override }

  return { weather, time, palette, autoWeather, autoTime }
}
