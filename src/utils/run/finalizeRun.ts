import type { Run, TrackPoint, MovementType } from '../../types'
import { fetchAreaName } from '../../hooks/useReverseGeocode'
import { fetchWeatherForCoords } from '../fetchWeather'
import { formatDate } from '../ui/formatters'

/**
 * 軌跡 + メタ情報から完了済みの Run を組み立てる (エリア名・天気を取得)。
 * 中断ランの「保存して終了」(復元) で使う。通常の FINISH は RecordingPage 側で組む。
 */
export async function buildRunFromPoints(opts: {
  id: string
  points: TrackPoint[]
  movementType: MovementType
}): Promise<Run> {
  const { id, points, movementType } = opts
  const lats = points.map(p => p.lat)
  const lngs = points.map(p => p.lng)
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2
  const [areaNameRaw, weatherRaw] = await Promise.all([
    fetchAreaName(centerLng, centerLat),
    fetchWeatherForCoords(centerLat, centerLng),
  ])
  return {
    id,
    name: `ラン ${formatDate(Date.now())}`,
    startedAt: points[0].timestamp,
    finishedAt: points.at(-1)!.timestamp,
    trackPoints: points,
    notes: [],
    areaName: areaNameRaw ?? undefined,
    weather: weatherRaw ?? 'sunny',
    movementType,
  }
}
