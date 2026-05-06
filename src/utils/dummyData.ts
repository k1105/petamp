import type { Run, TrackPoint } from '../types'

function makeTrack(
  waypoints: [number, number, number][],
  startMs: number,
  intervalMs = 8000,
): TrackPoint[] {
  const points: TrackPoint[] = []
  const PER = 10

  for (let i = 0; i < waypoints.length - 1; i++) {
    const [lng1, lat1, alt1] = waypoints[i]
    const [lng2, lat2, alt2] = waypoints[i + 1]
    for (let j = 0; j < PER; j++) {
      const t = j / PER
      points.push({
        lng: lng1 + (lng2 - lng1) * t,
        lat: lat1 + (lat2 - lat1) * t,
        altitude: alt1 + (alt2 - alt1) * t,
        timestamp: startMs + (i * PER + j) * intervalMs,
        accuracy: 5,
      })
    }
  }
  const last = waypoints[waypoints.length - 1]
  points.push({
    lng: last[0],
    lat: last[1],
    altitude: last[2],
    timestamp: startMs + (waypoints.length - 1) * PER * intervalMs,
    accuracy: 5,
  })
  return points
}

// Yoyogi Park outer loop
const yoyogi: [number, number, number][] = [
  [139.6920, 35.6685, 38],
  [139.6898, 35.6705, 40],
  [139.6886, 35.6730, 42],
  [139.6888, 35.6758, 46],
  [139.6906, 35.6778, 48],
  [139.6933, 35.6785, 47],
  [139.6960, 35.6778, 45],
  [139.6978, 35.6756, 43],
  [139.6980, 35.6728, 41],
  [139.6966, 35.6703, 39],
  [139.6944, 35.6689, 38],
  [139.6920, 35.6685, 38],
]

// Harajuku → Omotesando
const harajuku: [number, number, number][] = [
  [139.7018, 35.6700, 35],
  [139.7046, 35.6688, 34],
  [139.7078, 35.6693, 35],
  [139.7102, 35.6712, 37],
  [139.7096, 35.6735, 39],
  [139.7068, 35.6742, 38],
  [139.7038, 35.6732, 37],
  [139.7018, 35.6715, 36],
  [139.7018, 35.6700, 35],
]

const T1 = 1745806500000  // 2026-04-28 07:15 JST
const T2 = 1745977500000  // 2026-04-30 06:45 JST

function makeRun(id: string, name: string, waypoints: [number, number, number][], startMs: number): Run {
  const tp = makeTrack(waypoints, startMs)
  return {
    id,
    name,
    startedAt: startMs,
    finishedAt: tp[tp.length - 1].timestamp,
    trackPoints: tp,
    notes: [],
  }
}

export const DUMMY_RUNS: Run[] = [
  makeRun('dummy-1', '代々木公園ループ', yoyogi, T1),
  makeRun('dummy-2', '原宿〜表参道', harajuku, T2),
]

export const DUMMY_CENTER: [number, number] = [139.6960, 35.6730]
