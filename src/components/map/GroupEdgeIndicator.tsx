import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import { useMap } from './BaseMap'
import { useReverseGeocode } from '../../hooks/useReverseGeocode'
import { expandBboxByMeters, type LngLatBbox } from '../../utils/runBbox'
import type { RunGroup } from '../../utils/runGroups'

/**
 * パン中に padded bbox の縁に近づき、その方向に隣接 group が存在する間、
 * 縁付近に「次の group の地名 + 矢印」を表示する。タップで即ジャンプ。
 *
 * 表示閾値 (100m) は GroupNavigation のジャンプ閾値 (25m) より広く、
 * 「もう少しでジャンプする」という前置き表示になるよう設計。
 */
const SHOW_THRESHOLD_METERS = 100

// グループ間遷移は左右のみ。上下バウンダリーでは表示しない。
type EdgeDir = 'e' | 'w'

function detectEdgeDirection(
  center: [number, number],
  paddedBbox: LngLatBbox,
  thresholdMeters: number,
): EdgeDir | null {
  const [lng] = center
  const meanLat = (paddedBbox[0][1] + paddedBbox[1][1]) / 2
  const mPerLng = 111320 * Math.cos((meanLat * Math.PI) / 180)
  const dW = (lng - paddedBbox[0][0]) * mPerLng
  const dE = (paddedBbox[1][0] - lng) * mPerLng
  if (dW <= dE && dW <= thresholdMeters) return 'w'
  if (dE <= dW && dE <= thresholdMeters) return 'e'
  return null
}

function pickNextGroup(
  current: RunGroup,
  groups: RunGroup[],
  direction: EdgeDir,
): RunGroup | null {
  let best: { g: RunGroup; dist: number } | null = null
  for (const g of groups) {
    if (g.id === current.id) continue
    const dlng = g.center[0] - current.center[0]
    const dlat = g.center[1] - current.center[1]
    if (direction === 'e' && dlng <= 0) continue
    if (direction === 'w' && dlng >= 0) continue
    const dist = Math.hypot(dlng, dlat)
    if (!best || dist < best.dist) best = { g, dist }
  }
  return best?.g ?? null
}

const ARROW_ICON: Record<EdgeDir, string> = {
  e: 'lucide:chevron-right',
  w: 'lucide:chevron-left',
}

interface Props {
  currentGroup: RunGroup | null
  groups: RunGroup[]
  paddingMeters: number
  onTap: (groupId: string) => void
}

export function GroupEdgeIndicator({ currentGroup, groups, paddingMeters, onTap }: Props) {
  const { map } = useMap()
  const [state, setState] = useState<{ edge: EdgeDir; nextGroupId: string; nextCenter: [number, number] } | null>(null)

  useEffect(() => {
    if (!map || !currentGroup || groups.length < 2) {
      setState(null)
      return
    }
    const update = () => {
      const c = map.getCenter()
      const center: [number, number] = [c.lng, c.lat]
      const padded = expandBboxByMeters(currentGroup.bbox, paddingMeters)
      const edge = detectEdgeDirection(center, padded, SHOW_THRESHOLD_METERS)
      if (!edge) {
        setState(prev => (prev ? null : prev))
        return
      }
      const next = pickNextGroup(currentGroup, groups, edge)
      if (!next) {
        setState(prev => (prev ? null : prev))
        return
      }
      setState(prev =>
        prev && prev.edge === edge && prev.nextGroupId === next.id
          ? prev
          : { edge, nextGroupId: next.id, nextCenter: next.center },
      )
    }
    update()
    map.on('move', update)
    return () => {
      map.off('move', update)
    }
  }, [map, currentGroup, groups, paddingMeters])

  const name = useReverseGeocode(state?.nextCenter[0] ?? null, state?.nextCenter[1] ?? null)
  if (!state) return null

  const arrow = <Icon icon={ARROW_ICON[state.edge]} />
  const label = <span className="group-edge-indicator-name">{name ?? '...'}</span>
  // 進行方向側に矢印を置く: 東 → ラベルの後ろ / 西 → ラベルの前
  const reverseOrder = state.edge === 'e'

  return (
    <button
      className={`group-edge-indicator group-edge-indicator-${state.edge}`}
      onClick={() => onTap(state.nextGroupId)}
      aria-label={name ? `${name}に移動` : '隣のグループへ移動'}
      title={name ? `${name}に移動` : '隣のグループへ移動'}
    >
      {reverseOrder ? <>{label}{arrow}</> : <>{arrow}{label}</>}
    </button>
  )
}
