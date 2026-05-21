import type { NamedPlace } from './memory'

/**
 * NamedPlace と Run の軌跡の近接判定。
 * 距離計算は flat-earth 近似 (haversine の cos 補正のみ)。数十m〜数百m の判定では十分。
 */

const EARTH_R_M = 6371000

interface LatLng {
  lat: number
  lng: number
}

export function approxDistanceM(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const latRad = toRad((a.lat + b.lat) / 2)
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng) * Math.cos(latRad)
  return Math.sqrt(dLat * dLat + dLng * dLng) * EARTH_R_M
}

/** 点 p から、点列 track のうち最も近いノードまでの距離 (m)。 */
export function pointToTrackMinM(p: LatLng, track: ReadonlyArray<LatLng>): number {
  let min = Infinity
  for (const q of track) {
    const d = approxDistanceM(p, q)
    if (d < min) min = d
  }
  return min
}

/** NamedPlace と track の最小距離 (m)。 */
export function placeToTrackMinM(place: NamedPlace, track: ReadonlyArray<LatLng>): number {
  if (track.length === 0) return Infinity
  if (place.point) {
    return pointToTrackMinM(place.point, track)
  }
  if (place.polyline && place.polyline.length > 0) {
    // polyline の各ノードについて track 最小距離を取り、全体の最小値。
    // 厳密には線分 vs 線分の最近接距離だが、4-9m 間隔のノードで近似で十分。
    let min = Infinity
    for (const node of place.polyline) {
      const d = pointToTrackMinM(node, track)
      if (d < min) min = d
    }
    return min
  }
  return Infinity
}

/**
 * track の近く (thresholdM 以内) にある place を返す。
 * bbox 事前フィルタ → 詳細計算で、件数が増えても劣化しにくい。
 */
export function findNearbyPlaces(
  places: ReadonlyArray<NamedPlace>,
  track: ReadonlyArray<LatLng>,
  thresholdM: number,
): NamedPlace[] {
  if (places.length === 0 || track.length === 0) return []
  // track の bbox を thresholdM ぶん広げて、明らかに遠い place を弾く。
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const p of track) {
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
  }
  const latRad = ((minLat + maxLat) / 2) * (Math.PI / 180)
  const dLat = thresholdM / EARTH_R_M * (180 / Math.PI)
  const dLng = thresholdM / (EARTH_R_M * Math.cos(latRad)) * (180 / Math.PI)
  const padMinLat = minLat - dLat
  const padMaxLat = maxLat + dLat
  const padMinLng = minLng - dLng
  const padMaxLng = maxLng + dLng

  const inBbox = (q: LatLng) =>
    q.lat >= padMinLat && q.lat <= padMaxLat &&
    q.lng >= padMinLng && q.lng <= padMaxLng

  const out: NamedPlace[] = []
  for (const place of places) {
    // place 側のどれか1点でも padding 入り bbox に入っていれば詳細計算。
    let hit = false
    if (place.point && inBbox(place.point)) hit = true
    if (!hit && place.polyline) {
      for (const node of place.polyline) {
        if (inBbox(node)) { hit = true; break }
      }
    }
    if (!hit) continue
    if (placeToTrackMinM(place, track) <= thresholdM) out.push(place)
  }
  return out
}
