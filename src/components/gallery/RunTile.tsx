import { useMemo } from 'react'
import { Icon } from '@iconify/react'
import type { Run } from '../../types'
import type { PublicUser } from '../../firebase/userCloud'
import { totalDistance } from '../../utils/geoUtils'
import { acceptedPoints } from '../../utils/recordingFilters'
import { formatDistance, formatDate } from '../../utils/formatters'
import { buildRunSvgPath, RUN_SVG_VIEW_SIZE } from '../../utils/runSvgPath'

interface Props {
  run: Run
  /** フォロー中ユーザーのランの場合に owner プロフィールを渡す。自分のランでは null。 */
  owner?: PublicUser | null
  onDelete: (id: string) => void
  onSelect: (id: string) => void
}

export function RunTile({ run, owner, onDelete, onSelect }: Props) {
  const path = useMemo(() => buildRunSvgPath(run.trackPoints), [run.trackPoints])
  const dist = useMemo(() => totalDistance(acceptedPoints(run.trackPoints)), [run.trackPoints])
  const title = run.areaName ?? run.name
  const isOthers = !!owner

  return (
    <div className="run-tile" onClick={() => onSelect(run.id)}>
      <div className="run-tile-svg-wrap">
        <svg
          className="run-tile-svg"
          viewBox={`0 0 ${RUN_SVG_VIEW_SIZE} ${RUN_SVG_VIEW_SIZE}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {path ? (
            <path
              d={path}
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ) : null}
        </svg>
        {isOthers && (
          <div className="run-tile-owner" title={owner.displayName ?? ''}>
            {owner.photoURL ? (
              <img src={owner.photoURL} alt="" referrerPolicy="no-referrer" />
            ) : (
              <Icon icon="lucide:user" />
            )}
          </div>
        )}
      </div>

      <div className="run-tile-meta">
        <div className="run-tile-name">{title}</div>
        <div className="run-tile-stats">
          {formatDistance(dist)} · {formatDate(run.startedAt)}
        </div>
      </div>

      {!isOthers && (
        <button
          className="run-tile-delete"
          onClick={e => { e.stopPropagation(); onDelete(run.id) }}
          aria-label="削除"
        >
          <Icon icon="lucide:trash-2" />
        </button>
      )}
    </div>
  )
}
