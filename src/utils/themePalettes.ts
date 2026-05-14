export type Weather = 'sunny' | 'cloudy' | 'rainy'
export type TimeOfDay = 'morning' | 'day' | 'night'

export interface Palette {
  /** マップと背景の単色。 */
  bg: string
  /** キャラクター/軌跡/UI のアクセント色。無彩色 bg では緑のまま、有彩色 bg では bg と調和する色に切り替える。 */
  accent: string
}

export type PaletteKey = `${Weather}-${TimeOfDay}`

export const WEATHERS: readonly Weather[] = ['sunny', 'cloudy', 'rainy'] as const
export const TIMES: readonly TimeOfDay[] = ['morning', 'day', 'night'] as const

export const WEATHER_LABEL: Record<Weather, string> = {
  sunny: '晴れ',
  cloudy: '曇り',
  rainy: '雨',
}

export const TIME_LABEL: Record<TimeOfDay, string> = {
  morning: '朝',
  day: '昼',
  night: '夜',
}

/**
 * 既定パレット。3 weather × 3 time = 9 セル。
 * すべてアクセント緑 #1c975e の analogous レンジに収まる青緑寄りグレー/ティール。
 */
export const DEFAULT_PALETTES: Record<Weather, Record<TimeOfDay, Palette>> = {
  sunny: {
    morning: { bg: '#78CCE8', accent: '#4AC992' },
    day:     { bg: '#189AB4', accent: '#4AC992' },
    night:   { bg: '#1C1C1C', accent: '#1C975E' },
  },
  cloudy: {
    morning: { bg: '#819287', accent: '#1C975E' },
    day:     { bg: '#686E6C', accent: '#1C975E' },
    night:   { bg: '#262E2C', accent: '#1C975E' },
  },
  rainy: {
    morning: { bg: '#828B89', accent: '#1C6197' },
    day:     { bg: '#393C46', accent: '#1C6197' },
    night:   { bg: '#25272D', accent: '#1C6197' },
  },
}

export function paletteKey(w: Weather, t: TimeOfDay): PaletteKey {
  return `${w}-${t}`
}

export function getDefaultPalette(w: Weather, t: TimeOfDay): Palette {
  return DEFAULT_PALETTES[w][t]
}

/** ローカル時刻から時間帯を判定。朝 5-10 / 昼 10-17 / 夜 17-5。 */
export function getTimeOfDay(date: Date = new Date()): TimeOfDay {
  const h = date.getHours()
  if (h >= 5 && h < 10) return 'morning'
  if (h >= 10 && h < 17) return 'day'
  return 'night'
}

/**
 * Run 個別表示用のパレット。記録時の startedAt と weather から決定する。
 * 過去 Run (weather 未保存) は晴れにフォールバック。
 */
export function getPaletteForRun(run: {
  startedAt: number
  weather?: Weather
}): Palette {
  const time = getTimeOfDay(new Date(run.startedAt))
  const weather = run.weather ?? 'sunny'
  return getDefaultPalette(weather, time)
}

/** '#RRGGBB' → [R, G, B]。フォールバックはアクセント緑。 */
export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '')
  if (m.length !== 6) return [28, 151, 94]
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [28, 151, 94]
  return [r, g, b]
}

/** Open-Meteo / WMO weather_code を 3 種に集約。 */
export function weatherFromCode(code: number): Weather {
  if (code <= 1) return 'sunny'           // 0: 快晴, 1: ほぼ快晴
  if (code <= 48) return 'cloudy'         // 2-3 曇, 45/48 霧
  if (code >= 51 && code <= 67) return 'rainy'    // 霧雨・雨
  if (code >= 80 && code <= 82) return 'rainy'    // にわか雨
  if (code >= 95 && code <= 99) return 'rainy'    // 雷雨
  // 雪系 (71-77, 85-86) は曇り扱い
  return 'cloudy'
}
