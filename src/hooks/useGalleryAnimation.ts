import { useEffect, useRef, useState } from 'react'
import type { Run } from '../types'
import { acceptedPoints } from '../utils/recordingFilters'
import { rawAltitude } from '../utils/tubeMesh'

export interface DotPosition {
  runId: string
  position: [number, number]
}

export function positionAtTime(run: Run, loopSec: number): [number, number] | null {
  const pts = acceptedPoints(run.trackPoints)
  if (pts.length < 2) return null

  const absTs = run.startedAt + loopSec * 1000

  // clamp to run bounds
  if (absTs <= pts[0].timestamp) return [pts[0].lng, pts[0].lat]
  if (absTs >= pts[pts.length - 1].timestamp) return [pts[pts.length - 1].lng, pts[pts.length - 1].lat]

  // binary search
  let lo = 0, hi = pts.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (pts[mid].timestamp <= absTs) lo = mid
    else hi = mid
  }

  const a = pts[lo], b = pts[hi]
  const frac = (absTs - a.timestamp) / (b.timestamp - a.timestamp)
  return [a.lng + (b.lng - a.lng) * frac, a.lat + (b.lat - a.lat) * frac]
}

/**
 * loopSec の時点での相対高度 (m, 全点中の最低値を 0 基準) を返す。null は前値継続、
 * 先頭で値が無い間は 0。tube 側の relativeAltitudes と同じ規約。
 */
export function relAltitudeAtTime(run: Run, loopSec: number): number {
  const pts = acceptedPoints(run.trackPoints)
  if (pts.length === 0) return 0

  let baseline = Infinity
  for (const p of pts) {
    const v = rawAltitude(p)
    if (v != null && v < baseline) baseline = v
  }
  if (!Number.isFinite(baseline)) return 0

  const absTs = run.startedAt + loopSec * 1000
  if (absTs <= pts[0].timestamp) {
    const v = rawAltitude(pts[0])
    return v != null ? v - baseline : 0
  }
  if (absTs >= pts[pts.length - 1].timestamp) {
    // 末尾から逆走して有効値を探す (末尾だけ null の場合に備える)
    for (let i = pts.length - 1; i >= 0; i--) {
      const v = rawAltitude(pts[i])
      if (v != null) return v - baseline
    }
    return 0
  }

  let lo = 0, hi = pts.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (pts[mid].timestamp <= absTs) lo = mid
    else hi = mid
  }

  // a/b のどちらか欠損は他方を採用、両方欠損は 0 (= ベースラインのまま)
  const va = rawAltitude(pts[lo])
  const vb = rawAltitude(pts[hi])
  if (va == null && vb == null) return 0
  if (va == null) return (vb as number) - baseline
  if (vb == null) return va - baseline
  const frac = (absTs - pts[lo].timestamp) / (pts[hi].timestamp - pts[lo].timestamp)
  return (va + (vb - va) * frac) - baseline
}

export function useGalleryAnimation(runs: Run[], playbackSpeed = 60) {
  const [dots, setDots] = useState<DotPosition[]>([])
  const startRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (runs.length === 0) return

    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now
      const elapsed = ((now - startRef.current) / 1000) * playbackSpeed

      const next: DotPosition[] = []
      for (const run of runs) {
        const duration = (run.finishedAt - run.startedAt) / 1000
        if (duration <= 0) continue
        const loopSec = elapsed % duration
        const pos = positionAtTime(run, loopSec)
        if (pos) next.push({ runId: run.id, position: pos })
      }
      setDots(next)
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      startRef.current = null
    }
  }, [runs, playbackSpeed])

  return dots
}
