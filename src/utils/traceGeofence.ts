import { registerPlugin } from '@capacitor/core'
import type { Run, TrackPoint } from '../types'
import { haversineDistance } from './geo/geoUtils'

/**
 * 軌跡接近通知のネイティブ連携。
 *
 * JS 側は「過去の自分/友人の軌跡」を約 150m グリッドでクラスタリングして
 * 候補地点 (通知文付き) をネイティブへ渡すだけ。実際の監視は
 * ios/App/App/Plugins/TraceGeofenceManager.swift が iOS のリージョン監視 +
 * 大幅位置変更 (SLC) で行うため、常時 GPS は使わない。
 */

export interface GeofenceCandidate {
  id: string
  lat: number
  lng: number
  title: string
  body: string
}

interface TraceGeofencePlugin {
  setCandidates(options: { candidates: GeofenceCandidate[] }): Promise<{ count: number }>
  requestAlwaysPermission(): Promise<void>
  checkPermissions(): Promise<{ location: 'always' | 'whenInUse' | 'denied' | 'prompt' }>
}

export const TraceGeofence = registerPlugin<TraceGeofencePlugin>('TraceGeofence')

/** クラスタの一辺 ≒ リージョン半径 150m に合わせる */
const GRID_METERS = 150
/** UserDefaults と SLC 時の選択コストを抑えるための候補上限 */
const MAX_CANDIDATES = 300
/** 自宅など発着点が特定される場所を通知対象から外すための端点トリム量 */
const ENDPOINT_TRIM_METERS = 200
/** 直近すぎる自分のランは「かつての軌跡」ではないので除外する */
const OWN_RUN_MIN_AGE_MS = 24 * 60 * 60 * 1000
/** 1 ランあたりのサンプリング点数上限 (distanceFilter 0 で点が非常に密なため) */
const MAX_POINTS_PER_RUN = 60

/** 軌跡の先頭/末尾 trimMeters を落とす (発着点 = 自宅の露出と毎回の自宅通知を防ぐ)。 */
function trimEndpoints(points: TrackPoint[], trimMeters: number): TrackPoint[] {
  if (points.length < 3) return []
  let start = 0
  let acc = 0
  while (start < points.length - 1 && acc < trimMeters) {
    acc += haversineDistance(points[start], points[start + 1])
    start++
  }
  let end = points.length - 1
  acc = 0
  while (end > 0 && acc < trimMeters) {
    acc += haversineDistance(points[end - 1], points[end])
    end--
  }
  return start < end ? points.slice(start, end + 1) : []
}

interface Bucket {
  latSum: number
  lngSum: number
  count: number
  latestAt: number
  hasOwn: boolean
  friendUids: Set<string>
}

/**
 * 自分のローカルラン + フレンドのクラウドランをグリッドクラスタリングして
 * ジオフェンス候補にする。friendNames は uid → displayName。
 */
export function buildTraceCandidates(
  ownRuns: Run[],
  friendRuns: Run[],
  friendNames: Map<string, string | null>,
): GeofenceCandidate[] {
  const buckets = new Map<string, Bucket>()
  const latGrid = GRID_METERS / 111_000

  const addRun = (run: Run, ownerUid: string | null) => {
    const points = trimEndpoints(
      run.trackPoints.filter(p => p.rejected !== true),
      ENDPOINT_TRIM_METERS,
    )
    if (points.length === 0) return
    const stride = Math.max(1, Math.floor(points.length / MAX_POINTS_PER_RUN))
    for (let i = 0; i < points.length; i += stride) {
      const p = points[i]
      const lngGrid = GRID_METERS / (111_320 * Math.max(0.2, Math.cos((p.lat * Math.PI) / 180)))
      const key = `${Math.floor(p.lat / latGrid)}_${Math.floor(p.lng / lngGrid)}`
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { latSum: 0, lngSum: 0, count: 0, latestAt: 0, hasOwn: false, friendUids: new Set() }
        buckets.set(key, bucket)
      }
      bucket.latSum += p.lat
      bucket.lngSum += p.lng
      bucket.count++
      bucket.latestAt = Math.max(bucket.latestAt, run.finishedAt)
      if (ownerUid === null) bucket.hasOwn = true
      else bucket.friendUids.add(ownerUid)
    }
  }

  const now = Date.now()
  for (const run of ownRuns) {
    if (now - run.finishedAt < OWN_RUN_MIN_AGE_MS) continue
    addRun(run, null)
  }
  for (const run of friendRuns) {
    if (run.ownerUid) addRun(run, run.ownerUid)
  }

  return [...buckets.entries()]
    .sort((a, b) => b[1].latestAt - a[1].latestAt)
    .slice(0, MAX_CANDIDATES)
    .map(([key, b]) => ({
      id: key,
      lat: b.latSum / b.count,
      lng: b.lngSum / b.count,
      title: 'petamp',
      body: candidateBody(b, friendNames),
    }))
}

function candidateBody(bucket: Bucket, friendNames: Map<string, string | null>): string {
  const firstFriend = [...bucket.friendUids][0]
  const friendName = firstFriend ? (friendNames.get(firstFriend) ?? 'ともだち') : null
  if (friendName && bucket.hasOwn) {
    return `${friendName}さんやあなたが走った道の近くにいます`
  }
  if (friendName) {
    return `${friendName}さんが走った道の近くにいます`
  }
  return 'あなたがかつて走った道の近くにいます'
}
