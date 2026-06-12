import { useEffect } from 'react'
import { fetchAreaName } from './useReverseGeocode'
import { useRunStore } from '../store/useRunStore'
import type { Run } from '../types'

/**
 * 過去のラン (areaName 未保存) を初回表示時にバックフィルする。
 * 軌跡 bbox の中心を逆ジオコーディングし、取れたら updateRun で永続化して
 * onUpdated に更新後の Run を返す。RunDetailPage / RunResultPage で共用。
 *
 * @param enabled 他人のランなど書き込み対象外の場合は false
 */
export function useRunMetadata(
  run: Run | null,
  onUpdated: (run: Run) => void,
  enabled = true,
) {
  const updateRun = useRunStore(s => s.updateRun)
  useEffect(() => {
    if (!enabled || !run || run.areaName) return
    const lats = run.trackPoints.map(p => p.lat)
    const lngs = run.trackPoints.map(p => p.lng)
    if (lats.length === 0) return
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2
    fetchAreaName(centerLng, centerLat).then(name => {
      if (!name) return
      updateRun(run.id, { areaName: name }).then(updated => {
        if (updated) onUpdated(updated)
      })
    })
  }, [run, enabled, updateRun, onUpdated])
}
