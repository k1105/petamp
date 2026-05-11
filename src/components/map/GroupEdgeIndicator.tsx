import { useMemo } from 'react'
import { Icon } from '@iconify/react'
import { useReverseGeocode } from '../../hooks/useReverseGeocode'
import type { RunGroup } from '../../utils/runGroups'

type EdgeDir = 'e' | 'w'

function pickNextGroup(
  current: RunGroup,
  groups: RunGroup[],
  direction: EdgeDir,
): RunGroup | null {
  let best: { g: RunGroup; dist: number } | null = null
  for (const g of groups) {
    if (g.id === current.id) continue
    const dlng = g.center[0] - current.center[0]
    if (direction === 'e' && dlng <= 0) continue
    if (direction === 'w' && dlng >= 0) continue
    const dlat = g.center[1] - current.center[1]
    const dist = Math.hypot(dlng, dlat)
    if (!best || dist < best.dist) best = { g, dist }
  }
  return best?.g ?? null
}

const ARROW_ICON: Record<EdgeDir, string> = {
  e: 'lucide:chevron-right',
  w: 'lucide:chevron-left',
}

function EdgeButton({
  dir,
  target,
  onTap,
}: {
  dir: EdgeDir
  target: RunGroup
  onTap: (id: string) => void
}) {
  const name = useReverseGeocode(target.center[0], target.center[1])
  const arrow = <Icon icon={ARROW_ICON[dir]} />
  const label = <span className="group-edge-indicator-name">{name ?? '...'}</span>
  // 進行方向側に矢印を置く: 東 → ラベルの後ろ / 西 → ラベルの前
  const reverseOrder = dir === 'e'
  return (
    <button
      className={`group-edge-indicator group-edge-indicator-${dir}`}
      onClick={() => onTap(target.id)}
      aria-label={name ? `${name}に移動` : '隣のグループへ移動'}
      title={name ? `${name}に移動` : '隣のグループへ移動'}
    >
      {reverseOrder ? <>{label}{arrow}</> : <>{arrow}{label}</>}
    </button>
  )
}

interface Props {
  currentGroup: RunGroup | null
  groups: RunGroup[]
  onTap: (groupId: string) => void
}

/**
 * 隣接グループ (現在 group の東 / 西で最近接) を画面端に常時表示する。
 * タップで即ジャンプ。パン位置に応じた表示切替は行わない。
 */
export function GroupEdgeIndicator({ currentGroup, groups, onTap }: Props) {
  const east = useMemo(
    () => (currentGroup ? pickNextGroup(currentGroup, groups, 'e') : null),
    [currentGroup, groups],
  )
  const west = useMemo(
    () => (currentGroup ? pickNextGroup(currentGroup, groups, 'w') : null),
    [currentGroup, groups],
  )
  if (!currentGroup) return null
  return (
    <>
      {west && <EdgeButton dir="w" target={west} onTap={onTap} />}
      {east && <EdgeButton dir="e" target={east} onTap={onTap} />}
    </>
  )
}
