import type { TrackPoint } from '../../types'
import { haversineDistance } from '../geo/geoUtils'
import { classifyBehavior, type BehaviorState } from './runBehavior'
import { fetchAreaName } from '../../hooks/useReverseGeocode'

/**
 * ラン個別ページの "Nutrition Facts" (成分表示) タブで使う集計ロジック。
 * 軌跡が持つ情報を「比率」として取り出す:
 *  - 速度の比率 (run / walk / stop) … 滞在時間で加重 (stop は距離 0 なので距離加重では出ない)
 *  - エリアの比率 (市区町村) … 移動距離で加重し、逆ジオコーディングで地名を解決
 */

/** 速度帯 (振る舞い) の占有比率。time で加重する。 */
export interface SpeedShare {
  behavior: BehaviorState
  /** この振る舞いで過ごした時間 (秒) */
  durationSec: number
  /** 全体に占める比率 0..1 */
  ratio: number
}

/** 速度帯の表示順と英語ラベル。run → walk → stop の順で並べる。 */
export const SPEED_SHARE_META: { behavior: BehaviorState; label: string }[] = [
  { behavior: 'running', label: 'Run' },
  { behavior: 'walking', label: 'Walk' },
  { behavior: 'resting', label: 'Stop' },
]

/**
 * 軌跡を running / walking / resting に分類し、各帯の滞在時間比率を返す。
 * stop (resting) は距離が出ないため、距離ではなく時間で加重する。
 * 比率が 0 の帯も SPEED_SHARE_META の順で必ず含めて返す。
 */
export function computeSpeedBreakdown(points: TrackPoint[]): SpeedShare[] {
  if (points.length < 2) return []
  const labels = classifyBehavior(points)
  const byBehavior = new Map<BehaviorState, number>()
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const dt = (points[i].timestamp - points[i - 1].timestamp) / 1000
    if (dt <= 0) continue
    // 区間の振る舞いは終点のラベルに帰属させる (セグメント化と同じ流儀)。
    const beh = labels[i]
    byBehavior.set(beh, (byBehavior.get(beh) ?? 0) + dt)
    total += dt
  }
  if (total <= 0) return []
  return SPEED_SHARE_META.map(({ behavior }) => {
    const durationSec = byBehavior.get(behavior) ?? 0
    return { behavior, durationSec, ratio: durationSec / total }
  })
}

/** エリア (市区町村) の占有比率。distance で加重する。 */
export interface AreaShare {
  /** 逆ジオコーディングで解決した地名 (英語)。解決できなければ 'Unknown'。 */
  name: string
  /** このエリアを移動した距離 (m) */
  distanceM: number
  /** 全体に占める比率 0..1 */
  ratio: number
}

function coordKey(lng: number, lat: number): string {
  // fetchAreaName の内部キャッシュと同じ ~1km グリッド粒度で丸める。
  return `${lng.toFixed(2)},${lat.toFixed(2)}`
}

/**
 * 各区間の中点を逆ジオコーディングして、移動距離をエリアごとに按分する。
 * 逆ジオコーディングは ~1km グリッドでキャッシュされるので、まず一意な座標だけ
 * 解決してから距離を割り当てる (API 呼び出しの重複を避ける)。
 * 比率の大きい順にソートして返す。token 不在・他人のランなどで地名が引けない
 * 区間は 'Unknown' にまとめる。
 */
export async function computeAreaBreakdown(points: TrackPoint[]): Promise<AreaShare[]> {
  if (points.length < 2) return []

  const segments: { key: string; distanceM: number }[] = []
  const uniqueCoords = new Map<string, { lng: number; lat: number }>()
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const distanceM = haversineDistance(a, b)
    if (distanceM <= 0) continue
    const lng = (a.lng + b.lng) / 2
    const lat = (a.lat + b.lat) / 2
    const key = coordKey(lng, lat)
    segments.push({ key, distanceM })
    if (!uniqueCoords.has(key)) uniqueCoords.set(key, { lng, lat })
  }
  if (segments.length === 0) return []

  const entries = [...uniqueCoords.entries()]
  const resolved = await Promise.all(
    entries.map(([, c]) => fetchAreaName(c.lng, c.lat)),
  )
  const nameByKey = new Map<string, string>()
  entries.forEach(([key], i) => nameByKey.set(key, resolved[i] || 'Unknown'))

  const byName = new Map<string, number>()
  let total = 0
  for (const seg of segments) {
    const name = nameByKey.get(seg.key) ?? 'Unknown'
    byName.set(name, (byName.get(name) ?? 0) + seg.distanceM)
    total += seg.distanceM
  }
  if (total <= 0) return []

  return [...byName.entries()]
    .map(([name, distanceM]) => ({ name, distanceM, ratio: distanceM / total }))
    .sort((a, b) => b.distanceM - a.distanceM)
}
