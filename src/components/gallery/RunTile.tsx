import { useEffect, useMemo, useRef } from 'react'
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
  /** 自分のランを長押ししたとき、編集シート (種別変更・削除) を開く。 */
  onRequestEdit: (id: string) => void
  onSelect: (id: string) => void
}

const LONG_PRESS_MS = 500
/** 長押し中にこれ以上動いたらスクロール操作とみなしてキャンセル */
const MOVE_CANCEL_PX = 10

export function RunTile({ run, owner, onRequestEdit, onSelect }: Props) {
  const path = useMemo(() => buildRunSvgPath(run.trackPoints), [run.trackPoints])
  const dist = useMemo(() => totalDistance(acceptedPoints(run.trackPoints)), [run.trackPoints])
  const title = run.areaName ?? run.name
  const isOthers = !!owner

  const timerRef = useRef<number | null>(null)
  const longPressedRef = useRef(false)
  const startPosRef = useRef<{ x: number; y: number } | null>(null)

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => clearTimer, [])

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isOthers) return
    longPressedRef.current = false
    startPosRef.current = { x: e.clientX, y: e.clientY }
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      longPressedRef.current = true
      onRequestEdit(run.id)
    }, LONG_PRESS_MS)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!startPosRef.current) return
    const dx = e.clientX - startPosRef.current.x
    const dy = e.clientY - startPosRef.current.y
    if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) clearTimer()
  }

  const handleClick = () => {
    // 長押しで削除確認を開いた場合は、続く click による選択を抑制する
    if (longPressedRef.current) {
      longPressedRef.current = false
      return
    }
    onSelect(run.id)
  }

  return (
    <div
      className="run-tile"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearTimer}
      onPointerCancel={clearTimer}
      onPointerLeave={clearTimer}
      onContextMenu={e => e.preventDefault()}
    >
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
    </div>
  )
}
