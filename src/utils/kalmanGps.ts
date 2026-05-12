import type { TrackPoint } from '../types'

// 緯度1度の距離(m)。実用上、緯度方向はほぼ一定。経度はcos(lat)で補正する。
const METERS_PER_DEGREE_LAT = 111320

export interface KalmanGpsConfig {
  /** プロセスノイズ。加速度の標準偏差 (m/s²)。高いほど観測を信用し追従が早い。 */
  sigmaA: number
  /** Mahalanobis² ゲート閾値 (自由度2)。5.99=95%, 9.21=99%, 11.83=99.7%。 */
  gateChi2: number
  /** accuracy が無い/0 の点に対するフォールバック観測分散 (m²)。 */
  fallbackVarianceM2: number
  /** vel の初期分散 (m/s)²。10 m/s² = ある程度の急発進を許す。 */
  initialVelVariance: number
}

export const DEFAULT_KALMAN_CONFIG: KalmanGpsConfig = {
  sigmaA: 2,
  gateChi2: 9.21,
  fallbackVarianceM2: 400,
  initialVelVariance: 100,
}

// 1軸 (pos, vel) の状態と 2x2 共分散 [[p00, p01], [p01, p11]]。
interface AxisState {
  pos: number
  vel: number
  p00: number
  p01: number
  p11: number
}

export interface KalmanGpsState {
  x: AxisState // east (m)
  y: AxisState // north (m)
  lat0: number
  lng0: number
  metersPerDegLng: number
  lastT: number
}

function predictAxis(s: AxisState, dt: number, sigmaA: number): AxisState {
  // F = [[1, dt], [0, 1]]; P_pred = F P F^T + Q
  // Q = sa² * [[dt⁴/4, dt³/2], [dt³/2, dt²]]
  const sa2 = sigmaA * sigmaA
  const dt2 = dt * dt
  const dt3 = dt2 * dt
  const dt4 = dt3 * dt
  const p00 = s.p00 + 2 * dt * s.p01 + dt2 * s.p11 + (sa2 * dt4) / 4
  const p01 = s.p01 + dt * s.p11 + (sa2 * dt3) / 2
  const p11 = s.p11 + sa2 * dt2
  return { pos: s.pos + s.vel * dt, vel: s.vel, p00, p01, p11 }
}

function updateAxis(s: AxisState, z: number, r: number): AxisState {
  // H = [1, 0]; S = p00 + r; K = P H^T / S = [p00/S, p01/S]
  const sInnov = s.p00 + r
  const k0 = s.p00 / sInnov
  const k1 = s.p01 / sInnov
  const innov = z - s.pos
  return {
    pos: s.pos + k0 * innov,
    vel: s.vel + k1 * innov,
    p00: (1 - k0) * s.p00,
    p01: (1 - k0) * s.p01,
    p11: s.p11 - k1 * s.p01,
  }
}

function obsVariance(p: TrackPoint, config: KalmanGpsConfig): number {
  if (p.accuracy == null || p.accuracy <= 0) return config.fallbackVarianceM2
  return p.accuracy * p.accuracy
}

function project(state: KalmanGpsState, lat: number, lng: number): { x: number; y: number } {
  return {
    x: (lng - state.lng0) * state.metersPerDegLng,
    y: (lat - state.lat0) * METERS_PER_DEGREE_LAT,
  }
}

export function initKalmanGps(p: TrackPoint, config: KalmanGpsConfig): KalmanGpsState {
  const variance = obsVariance(p, config)
  const cosLat0 = Math.cos((p.lat * Math.PI) / 180)
  return {
    x: { pos: 0, vel: 0, p00: variance, p01: 0, p11: config.initialVelVariance },
    y: { pos: 0, vel: 0, p00: variance, p01: 0, p11: config.initialVelVariance },
    lat0: p.lat,
    lng0: p.lng,
    metersPerDegLng: METERS_PER_DEGREE_LAT * cosLat0,
    lastT: p.timestamp,
  }
}

export interface KalmanCheckResult {
  ok: boolean
  mahalanobis2: number
  /** 採用される場合の次状態。reject 時は null。 */
  next: KalmanGpsState | null
}

/**
 * 既存 state に対し新観測 p を Mahalanobis 距離でゲートする。
 * 通過時は更新後の state を返す。reject 時は state を更新しない (lastT も据え置き)。
 */
export function kalmanCheck(
  state: KalmanGpsState,
  p: TrackPoint,
  config: KalmanGpsConfig,
): KalmanCheckResult {
  const dt = (p.timestamp - state.lastT) / 1000
  if (dt <= 0) {
    // 同時刻 or 巻き戻り。安全側に倒して reject。
    return { ok: false, mahalanobis2: Infinity, next: null }
  }
  const xPred = predictAxis(state.x, dt, config.sigmaA)
  const yPred = predictAxis(state.y, dt, config.sigmaA)
  const obs = project(state, p.lat, p.lng)
  const r = obsVariance(p, config)
  const dx = obs.x - xPred.pos
  const dy = obs.y - yPred.pos
  const sx = xPred.p00 + r
  const sy = yPred.p00 + r
  const mahalanobis2 = (dx * dx) / sx + (dy * dy) / sy
  if (mahalanobis2 > config.gateChi2) {
    return { ok: false, mahalanobis2, next: null }
  }
  return {
    ok: true,
    mahalanobis2,
    next: {
      ...state,
      x: updateAxis(xPred, obs.x, r),
      y: updateAxis(yPred, obs.y, r),
      lastT: p.timestamp,
    },
  }
}
