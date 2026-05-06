import type { TrackPoint } from '../../types'
import { totalDistance } from '../../utils/geoUtils'
import { formatDistance, formatElevation } from '../../utils/formatters'
import { useElevationStats } from '../../hooks/useElevationStats'

interface LiveStatsProps {
  trackPoints: TrackPoint[]
}

export function LiveStats({ trackPoints }: LiveStatsProps) {
  const { gain, current } = useElevationStats(trackPoints)
  const dist = totalDistance(trackPoints)

  return (
    <div className="live-stats">
      <div className="stat">
        <span className="stat-label">距離</span>
        <span className="stat-value">{formatDistance(dist)}</span>
      </div>
      <div className="stat">
        <span className="stat-label">獲得標高</span>
        <span className="stat-value">{formatElevation(gain)}</span>
      </div>
      {current !== null && (
        <div className="stat">
          <span className="stat-label">現在標高</span>
          <span className="stat-value">{formatElevation(current)}</span>
        </div>
      )}
    </div>
  )
}
