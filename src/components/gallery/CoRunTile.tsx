import { useMemo } from 'react'
import { Icon } from '@iconify/react'
import type { Run } from '../../types'
import type { PublicUser } from '../../firebase/userCloud'
import { totalDistance } from '../../utils/geo/geoUtils'
import { acceptedPoints } from '../../utils/geo/recordingFilters'
import { formatDistance, formatDate } from '../../utils/ui/formatters'
import { buildSharedRunSvgPaths, RUN_SVG_VIEW_SIZE } from '../../utils/path/runSvgPath'
import { memberColor, rgbCss } from '../../utils/run/coRunColors'

interface Props {
  /** 同一 co-run セッションのラン (自分 + 相手)。自分のランは ownerUid 無しで先頭付近に来る。 */
  runs: Run[]
  /** uid → フォロー中ユーザープロフィール (アバター表示用)。 */
  ownerByUid: Map<string, PublicUser>
  /** 自分のラン (無ければ先頭) の runId を渡す。個別ラン画面で N 本を合成再生する。 */
  onSelect: (runId: string) => void
}

/**
 * 「一緒に走った」ランを 1 タイルに統合し、参加者の軌跡を色分けで重ねて描く。
 * タップで個別ラン画面 (/run/:id) へ。表示中ランが coRunSessionId を持つので、
 * そこで参加者全員の軌跡を合成再生する (専用画面は廃止)。
 */
export function CoRunTile({ runs, ownerByUid, onSelect }: Props) {
  // 自分のラン (ownerUid 無し) を先頭にして色順を安定させる。
  const ordered = useMemo(
    () => [...runs].sort((a, b) => (a.ownerUid ? 1 : 0) - (b.ownerUid ? 1 : 0)),
    [runs],
  )
  const paths = useMemo(
    () => buildSharedRunSvgPaths(ordered.map(r => r.trackPoints)),
    [ordered],
  )
  const mine = ordered.find(r => !r.ownerUid) ?? ordered[0]
  const title = mine.areaName ?? mine.name
  const dist = useMemo(() => totalDistance(acceptedPoints(mine.trackPoints)), [mine])

  const others = ordered.filter(r => !!r.ownerUid)

  return (
    <div className="run-tile co-run-tile" onClick={() => onSelect(mine.id)}>
      <div className="run-tile-svg-wrap">
        <svg
          className="run-tile-svg"
          viewBox={`0 0 ${RUN_SVG_VIEW_SIZE} ${RUN_SVG_VIEW_SIZE}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {paths.map((d, i) =>
            d ? (
              <path
                key={ordered[i].id}
                d={d}
                stroke={rgbCss(memberColor(i))}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ) : null,
          )}
        </svg>
        <div className="co-run-tile-badge" title="一緒に走ったラン">
          <Icon icon="lucide:users" />
        </div>
        {others.length > 0 && (
          <div className="co-run-tile-avatars">
            {others.slice(0, 3).map(r => {
              const owner = r.ownerUid ? ownerByUid.get(r.ownerUid) : null
              return (
                <span key={r.id} className="co-run-tile-avatar">
                  {owner?.photoURL ? (
                    <img src={owner.photoURL} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <Icon icon="lucide:user" />
                  )}
                </span>
              )
            })}
          </div>
        )}
      </div>

      <div className="run-tile-meta">
        <div className="run-tile-name">{title}</div>
        <div className="run-tile-stats">
          {formatDistance(dist)} · {formatDate(mine.startedAt)}
        </div>
      </div>
    </div>
  )
}
