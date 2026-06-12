import { useEffect, useMemo, useState } from 'react'
import { expandBboxByMeters } from '../utils/run/runBbox'
import {
  groupRunsByBboxOverlap,
  makeHomeGroup,
  findGroupContaining,
  type RunGroup,
} from '../utils/run/runGroups'
import type { Run } from '../types'

// Home (initial) state config — small fixed-size cage centred on GPS at a
// fixed zoom, distinct from any recorded group. Pan-to-edge from here jumps
// to the nearest real group.
const HOME_HALF_SIZE_METERS = 150
export const HOME_FIXED_ZOOM = 17.5

export interface GroupNavigation {
  allGroups: RunGroup[]
  currentGroup: RunGroup | null
  currentGroupId: string | null
  setCurrentGroupId: (id: string | null) => void
  isHome: boolean
  /** 現在位置を含む実グループ (なければ null)。FAB タップ時の group 合流先判定に使う。 */
  containingRealGroup: RunGroup | null
  homeGroup: RunGroup | null
  /** BaseMap の初期 bounds。home 立ち上げ時や GPS が realGroup 内のときは undefined。 */
  initialBounds: [[number, number], [number, number]] | undefined
}

/**
 * Gallery のグループナビゲーション状態。
 * ランを bbox 重なりでグループ化し、現在位置から home pseudo-group / 合流先を決め、
 * 選択中グループと BaseMap の初期 bounds を導出する。
 */
export function useGroupNavigation(
  runs: Run[],
  mapPaddingMeters: number,
  initialCenter: [number, number] | null | undefined,
  runsLoaded: boolean,
): GroupNavigation {
  // Phase 2: cluster runs into actual groups.
  const realGroups = useMemo(
    () => groupRunsByBboxOverlap(runs, mapPaddingMeters),
    [runs, mapPaddingMeters],
  )

  // 現在位置が既存グループ (padded bbox) に含まれていればそのグループに合流。
  // 含まれていない場合のみ home pseudo-group を生成する。
  const containingRealGroup = useMemo(
    () => (initialCenter ? findGroupContaining(realGroups, initialCenter, mapPaddingMeters) : null),
    [initialCenter, realGroups, mapPaddingMeters],
  )

  // Phase 4: synthesise a "home" pseudo-group at GPS so the initial mount
  // sits at a small fixed cage instead of snapping into a recorded group.
  const homeGroup = useMemo(
    () => (initialCenter && !containingRealGroup ? makeHomeGroup(initialCenter, HOME_HALF_SIZE_METERS) : null),
    [initialCenter, containingRealGroup],
  )

  // Combined list passed to GroupNavigation — pan-to-edge can move between
  // home and any real group, and between real groups.
  const allGroups = useMemo(
    () => (homeGroup ? [homeGroup, ...realGroups] : realGroups),
    [homeGroup, realGroups],
  )

  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null)
  // GPS確定 (success or null) を待ってから default group を決める。
  // これでBaseMap マウント時から正しい中心 (= 現在位置 home) で立ち上がり、
  // 「先にrealGroupに着地→後からhomeへ animate」のずれが起きない。
  useEffect(() => {
    if (!runsLoaded) return
    if (initialCenter === undefined) return
    if (currentGroupId && allGroups.some(g => g.id === currentGroupId)) return
    if (homeGroup) {
      // GPS 確定後の default group 選択。複数候補をまとめて初期化する都合上同期セット。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentGroupId('home')
    } else {
      setCurrentGroupId(containingRealGroup?.id ?? realGroups[0]?.id ?? null)
    }
  }, [runsLoaded, allGroups, currentGroupId, homeGroup, containingRealGroup, realGroups, initialCenter])

  const currentGroup = useMemo(
    () => allGroups.find(g => g.id === currentGroupId) ?? null,
    [allGroups, currentGroupId],
  )

  const isHome = currentGroup?.id === 'home'

  // BaseMap initial position. Home: GPS center + fixed zoom (no `bounds`
  // option since we want the explicit fixed scale, not bbox-fit). Real
  // group: padded bbox passed via `bounds` for tight fit.
  // 例外: 現在位置が realGroup に含まれている初期状態では home スケールで
  // 立ち上げる (bounds を渡さない)。MapBoundsConstraint が group bbox を
  // maxBounds として後から適用する。
  const initialBounds = useMemo(() => {
    if (!runsLoaded || !currentGroup || isHome) return undefined
    if (containingRealGroup && currentGroup.id === containingRealGroup.id) return undefined
    return expandBboxByMeters(currentGroup.bbox, mapPaddingMeters) as [[number, number], [number, number]]
  }, [runsLoaded, currentGroup, isHome, mapPaddingMeters, containingRealGroup])

  return {
    allGroups,
    currentGroup,
    currentGroupId,
    setCurrentGroupId,
    isHome,
    containingRealGroup,
    homeGroup,
    initialBounds,
  }
}
