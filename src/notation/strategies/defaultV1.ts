import type { Run, TrackPoint } from '../../types'
import { acceptedPoints } from '../../utils/recordingFilters'
import { haversineDistance } from '../../utils/geoUtils'
import type { NotationStrategy, Phoneme } from '../types'

interface SpeedBucket {
  symbol: string
  /** 上限 m/s (含まない)。先頭から順に判定するため境界は昇順で記述。 */
  upper: number
}

/**
 * 速度→音素マッピング (叩き台 v1)。境界値は実走データで詰める前提。
 * 並びは下から順、最初に match した bucket が選ばれる。
 */
const BUCKETS: SpeedBucket[] = [
  { symbol: '・',      upper: 0.3 },
  { symbol: 'ペタン',   upper: 1.5 },
  { symbol: 'ペタ', upper: 2.5 },
  { symbol: 'ペッ',     upper: 3.8 },
  { symbol: 'ぺっ',     upper: 5.5 },
  { symbol: 'ピー',     upper: Number.POSITIVE_INFINITY },
]

/** 高度勾配がこの絶対値 (m/秒) を超えたら pitch 変調を載せる。 */
const PITCH_GRADIENT_THRESHOLD = 0.15

function classifySpeed(speedMps: number): string {
  for (const b of BUCKETS) {
    if (speedMps < b.upper) return b.symbol
  }
  return BUCKETS[BUCKETS.length - 1].symbol
}

function pitchFromGradient(gradient: number): -1 | 0 | 1 {
  if (gradient > PITCH_GRADIENT_THRESHOLD) return 1
  if (gradient < -PITCH_GRADIENT_THRESHOLD) return -1
  return 0
}

/**
 * セグメント単位 (= 隣り合う採用点ペアごと) に 1 Phoneme を返す。マージ・sharp 吸収は行わない。
 * 主にビジュアライザ側で「1 座標点 1 音素」レンダリングをするために使う。
 * defaultV1Strategy.encode はこの結果を後段でマージしている。
 */
function encodeSegments(run: Run): Phoneme[] {
  const pts = acceptedPoints(run.trackPoints)
  if (pts.length < 2) return []
  const out: Phoneme[] = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const dt = (b.timestamp - a.timestamp) / 1000
    if (dt <= 0) continue
    const dist = haversineDistance(a, b)
    const speed = dist / dt
    const symbol = classifySpeed(speed)
    const pitch = symbol === '・' ? 0 : pitchFromGradient(altitudeGradient(a, b, dt))
    out.push({
      symbol,
      durationMs: dt * 1000,
      pitch,
      sharp: false,
      weak: false,
      startPointIdx: i - 1,
      endPointIdx: i,
    })
  }
  return out
}

export const defaultV1Strategy: NotationStrategy = {
  id: 'notation.strategy.defaultV1',
  encode(run: Run): Phoneme[] {
    const segments = encodeSegments(run)
    if (segments.length === 0) return []

    // ステップ2: 同symbol/同pitchが連続する区間を1つの Phoneme に集約
    const phonemes: Phoneme[] = []
    for (const s of segments) {
      const last = phonemes[phonemes.length - 1]
      if (last && last.symbol === s.symbol && last.pitch === s.pitch) {
        last.durationMs += s.durationMs
        last.endPointIdx = s.endPointIdx
      } else {
        // segments の Phoneme は再利用せずコピーする (encodeSegments の戻り値を不変に保つ)
        phonemes.push({ ...s })
      }
    }

    // ステップ3: 直前 walking/jog 中に短い停止 (< 400ms) は無視ではなく `sharp` 変調として吸収
    // (足を一瞬止める = ペタッ の感覚)。短停止が長い停止に化けないように。
    return phonemes.map((p, idx) => {
      if (p.symbol !== '・' || p.durationMs >= 400) return p
      const prev = phonemes[idx - 1]
      if (!prev) return p
      return { ...prev, sharp: true, endPointIdx: p.endPointIdx, durationMs: prev.durationMs }
    }).reduce<Phoneme[]>((acc, cur, idx, src) => {
      // sharp 変調を上流の Phoneme に取り込み、停止 Phoneme を間引く
      if (idx > 0 && cur === src[idx]) {
        const last = acc[acc.length - 1]
        if (last && cur.symbol === last.symbol && cur.sharp && !last.sharp) {
          last.sharp = true
          last.endPointIdx = cur.endPointIdx
          return acc
        }
      }
      acc.push(cur)
      return acc
    }, [])
  },
}

function altitudeGradient(a: TrackPoint, b: TrackPoint, dtSec: number): number {
  const aAlt = a.altitude ?? a.barometricAltitude ?? null
  const bAlt = b.altitude ?? b.barometricAltitude ?? null
  if (aAlt === null || bAlt === null || dtSec <= 0) return 0
  return (bAlt - aAlt) / dtSec
}
