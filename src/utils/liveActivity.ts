import { Capacitor, registerPlugin } from '@capacitor/core'
import type { TrackPoint } from '../types'
import { simplifyDouglasPeucker } from './geo/simplify'

// ランニング中のライブアクティビティ (iOS 16.2+) を制御するネイティブブリッジ。
// 実装は ios/App/App/Plugins/LiveActivityPlugin.swift。

interface LiveActivityPayload {
  runId: string
  /** x,y を交互に並べた 0..255 の量子化軌跡。 */
  pathQuant: number[]
  /** 元 bbox のアスペクト比 (幅/高さ)。 */
  aspect: number
  /** 今回ラン中の累計移動距離 (m)。 */
  distanceMeters: number
  /** 背景に使うテーマカラー ("#RRGGBB")。 */
  bgColor: string
}

interface LiveActivityPlugin {
  start(o: LiveActivityPayload): Promise<{ runId: string; activityId: string }>
  update(o: LiveActivityPayload): Promise<void>
  end(o: { runId: string }): Promise<void>
}

const LiveActivity = registerPlugin<LiveActivityPlugin>('LiveActivity')

// ActivityKit のペイロードは ~4KB 制限。軌跡はこの点数まで間引く。
const MAX_POINTS = 80

/**
 * 軌跡を 0..1 bbox 正規化 → 0..255 量子化し、80 点以下に間引く。
 * acceptedTrackPoints (rejected を含まない) を渡す前提。
 */
function buildPayload(
  runId: string,
  points: TrackPoint[],
  distanceMeters: number,
  bgColor: string,
): LiveActivityPayload {
  let simplified = points
  // 許容誤差を倍々にしながら MAX_POINTS 以下まで間引く。
  for (let tol = 2; simplified.length > MAX_POINTS && tol <= 256; tol *= 2) {
    simplified = simplifyDouglasPeucker(points, tol)
  }
  // それでも多ければ等間隔で間引いて上限を保証する。
  if (simplified.length > MAX_POINTS) {
    const stride = Math.ceil(simplified.length / MAX_POINTS)
    simplified = simplified.filter((_, i) => i % stride === 0)
  }

  let latMin = Infinity
  let latMax = -Infinity
  let lngMin = Infinity
  let lngMax = -Infinity
  for (const p of simplified) {
    if (p.lat < latMin) latMin = p.lat
    if (p.lat > latMax) latMax = p.lat
    if (p.lng < lngMin) lngMin = p.lng
    if (p.lng > lngMax) lngMax = p.lng
  }
  const latSpan = latMax - latMin || 1e-9
  const lngSpan = lngMax - lngMin || 1e-9
  // 経度は緯度に応じて圧縮される。実際の形を保つため cos(lat) を掛ける。
  const cosLat = Math.cos((latMin * Math.PI) / 180)
  const aspect = (lngSpan * cosLat) / latSpan || 1

  const pathQuant: number[] = []
  for (const p of simplified) {
    const x = (p.lng - lngMin) / lngSpan
    const y = 1 - (p.lat - latMin) / latSpan // 北を上にするため反転
    pathQuant.push(Math.round(x * 255), Math.round(y * 255))
  }

  return { runId, pathQuant, aspect, distanceMeters, bgColor }
}

let currentRunId: string | null = null

export async function startLiveActivity(
  runId: string,
  points: TrackPoint[],
  distanceMeters: number,
  bgColor: string,
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  currentRunId = runId
  try {
    await LiveActivity.start(buildPayload(runId, points, distanceMeters, bgColor))
  } catch (e) {
    // 未対応 OS / ユーザーが無効化 等。機能なしで続行する。
    console.warn('[LiveActivity] start failed', e)
  }
}

export async function updateLiveActivity(
  points: TrackPoint[],
  distanceMeters: number,
  bgColor: string,
): Promise<void> {
  if (!Capacitor.isNativePlatform() || !currentRunId) return
  try {
    await LiveActivity.update(buildPayload(currentRunId, points, distanceMeters, bgColor))
  } catch (e) {
    // 更新失敗は非致命。
    console.warn('[LiveActivity] update failed', e)
  }
}

export async function endLiveActivity(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !currentRunId) return
  const id = currentRunId
  currentRunId = null
  try {
    await LiveActivity.end({ runId: id })
  } catch {
    // 終了失敗は非致命。
  }
}
