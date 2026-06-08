import { createContext, useContext, useEffect, useState } from 'react'
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
 * 現在適用すべきテーマパレットを計算する。GPS / 天気 / 時刻の非同期入力に依存し、
 * 呼び出しごとに独立した内部状態 (useWeather の天気・now のクロック) を持つため、
 * 複数箇所から直接呼ぶと各インスタンスの解決タイミング差でパレットがズレる
 * (ページ背景 --bg とマップ fog が別々の色になる)。
 * そのため本関数は ActivePaletteProvider が一度だけ呼び、各 consumer は
 * useActivePalette() (= Context 読み取り) で共有値を参照すること。
 */
export function useComputeActivePalette(): ActivePalette {
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

/**
 * 全 consumer が共有する単一のアクティブパレット。ActivePaletteProvider が
 * ルートで一度だけ計算した値を流す。
 */
export const ActivePaletteContext = createContext<ActivePalette | null>(null)

/**
 * 共有アクティブパレットを返す。ActivePaletteProvider 配下でのみ使用可。
 * 直接 useComputeActivePalette を呼ばないことで、ページ背景 (--bg) とマップ色が
 * 常に同一のパレット値を参照するようになる。
 */
export function useActivePalette(): ActivePalette {
  const value = useContext(ActivePaletteContext)
  if (!value) {
    throw new Error('useActivePalette must be used within <ActivePaletteProvider>')
  }
  return value
}
