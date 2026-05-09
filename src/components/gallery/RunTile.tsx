import { useMemo } from 'react'
import { Icon } from '@iconify/react'
import { useNavigate } from 'react-router-dom'
import type { Run } from '../../types'
import { totalDistance } from '../../utils/geoUtils'
import { acceptedPoints } from '../../utils/recordingFilters'
import { formatDistance, formatDate } from '../../utils/formatters'
import { buildRunSvgPath, RUN_SVG_VIEW_SIZE } from '../../utils/runSvgPath'

interface Props {
  run: Run
  onDelete: (id: string) => void
}

export function RunTile({ run, onDelete }: Props) {
  const navigate = useNavigate()
  const path = useMemo(() => buildRunSvgPath(run.trackPoints), [run.trackPoints])
  const dist = useMemo(() => totalDistance(acceptedPoints(run.trackPoints)), [run.trackPoints])
  const title = run.areaName ?? run.name

  return (
    <div className="run-tile" onClick={() => navigate(`/run/${run.id}`)}>
      <div className="run-tile-svg-wrap">
        <svg
          className="run-tile-svg"
          viewBox={`0 0 ${RUN_SVG_VIEW_SIZE} ${RUN_SVG_VIEW_SIZE}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {path ? (
            <path
              d={path}
              stroke="#ffffff"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ) : null}
        </svg>
      </div>

      <div className="run-tile-meta">
        <div className="run-tile-name">{title}</div>
        <div className="run-tile-stats">
          {formatDistance(dist)} · {formatDate(run.startedAt)}
        </div>
      </div>

      <button
        className="run-tile-delete"
        onClick={e => { e.stopPropagation(); onDelete(run.id) }}
        aria-label="削除"
      >
        <Icon icon="lucide:trash-2" />
      </button>
    </div>
  )
}
