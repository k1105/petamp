import { weatherFromCode, type Weather } from './themePalettes'

/**
 * 緯度経度の地点の現在天気を Open-Meteo から取得し、3 種 (sunny/cloudy/rainy) に集約して返す。
 * 通信失敗・データ欠落時は null。録画完了時の永続化用 (useWeather と違いキャッシュなし)。
 */
export async function fetchWeatherForCoords(
  lat: number,
  lng: number,
): Promise<Weather | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=weather_code`
    const res = await fetch(url)
    const data = (await res.json()) as { current?: { weather_code?: number } }
    const code = data.current?.weather_code
    if (typeof code !== 'number') return null
    return weatherFromCode(code)
  } catch {
    return null
  }
}
