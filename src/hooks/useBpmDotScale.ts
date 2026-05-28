import { useEffect, useState } from 'react'
import { currentDotPulseScaleRef } from './useBpmSyncedBob'

// React-friendly view of currentDotPulseScaleRef. The ref is written every
// frame by useBpmSyncedBob; this hook copies it into state at rAF rate,
// throttled so we only re-render when the value moves meaningfully (>0.5%).
// Returns 1 when Spotify is idle / not playing — callers can safely multiply
// without conditional logic.
export function useBpmDotScale(): number {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    let raf = 0
    let lastValue = 1
    const tick = () => {
      const v = currentDotPulseScaleRef.current
      if (Math.abs(v - lastValue) > 0.005) {
        lastValue = v
        setScale(v)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return scale
}
