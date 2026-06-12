import { useMemo } from 'react'
import type { TrackPoint } from '../types'
import { elevationGain } from '../utils/geo/geoUtils'

export function useElevationStats(trackPoints: TrackPoint[]) {
  return useMemo(() => {
    const gain = elevationGain(trackPoints)
    const altitudes = trackPoints.map(p => p.altitude).filter((a): a is number => a !== null)
    const current = altitudes.at(-1) ?? null
    const min = altitudes.length > 0 ? Math.min(...altitudes) : null
    const max = altitudes.length > 0 ? Math.max(...altitudes) : null
    return { gain, current, min, max }
  }, [trackPoints])
}
