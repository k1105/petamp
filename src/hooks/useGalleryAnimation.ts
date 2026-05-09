import { useEffect, useRef, useState } from 'react'
import type { Run } from '../types'
import { acceptedPoints } from '../utils/recordingFilters'

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
