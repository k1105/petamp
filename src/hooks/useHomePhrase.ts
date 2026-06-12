import { useEffect, useMemo, useState } from 'react'
import { generateHomeAmbientPhrase, hasApiKey } from '../character'
import { nearbyRunCount } from '../utils/run/nearbyRuns'
import type { Run } from '../types'

const NEARBY_THRESHOLD_M = 300

/**
 * ホーム画面のambient発話を、現在GPS + 過去Runsをもとに生成する。
 * 近傍Run数が変わるたびに再生成。タップ等では再生成しない。
 */
export function useHomePhrase(
  gps: [number, number] | null | undefined,
  runs: Run[],
  runsLoaded: boolean,
): string | null {
  const [phrase, setPhrase] = useState<string | null>(null)

  const lng = gps?.[0]
  const lat = gps?.[1]

  const count = useMemo(() => {
    if (lng === undefined || lat === undefined || !runsLoaded) return null
    return nearbyRunCount([lng, lat], runs, NEARBY_THRESHOLD_M)
  }, [lng, lat, runs, runsLoaded])

  useEffect(() => {
    if (count === null || !hasApiKey()) return
    let cancelled = false
    void generateHomeAmbientPhrase({ nearbyRunCount: count })
      .then(p => {
        if (!cancelled) setPhrase(p)
      })
      .catch(() => {
        // 失敗は静かに無視: フォールバックは呼び出し側で
      })
    return () => {
      cancelled = true
    }
  }, [count])

  return phrase
}
