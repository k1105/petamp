import { Icon } from '@iconify/react'
import type { Run } from '../../types'
import { totalDistance, elevationGain } from '../../utils/geoUtils'
import { formatDistance, formatElevation, formatDate } from '../../utils/formatters'
import { useNavigate } from 'react-router-dom'

interface RunCardProps {
  run: Run
  onDelete: (id: string) => void
}

export function RunCard({ run, onDelete }: RunCardProps) {
  const navigate = useNavigate()
  const dist = totalDistance(run.trackPoints)
  const gain = elevationGain(run.trackPoints)

  return (
    <div className="run-card" onClick={() => navigate(`/run/${run.id}`)}>
      <div className="run-card-header">
        <span className="run-card-name">{run.name}</span>
        <button
          className="run-card-delete"
          onClick={e => { e.stopPropagation(); onDelete(run.id) }}
          aria-label="削除"
        >
          <Icon icon="lucide:trash-2" />
        </button>
      </div>
      <div className="run-card-date">{formatDate(run.startedAt)}</div>
      <div className="run-card-stats">
        <span>{formatDistance(dist)}</span>
        <span>↑{formatElevation(gain)}</span>
        <span>{run.trackPoints.length}点</span>
      </div>
    </div>
  )
}
