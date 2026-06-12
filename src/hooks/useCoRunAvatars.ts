import { useEffect, useState } from 'react'
import { loadCircularAvatar } from '../utils/circularAvatar'
import type { CoRunEntry } from './useCoRunReplay'

/**
 * co-run メンバーの Google アイコンを円形クロップして読み込む。
 * photoURL → data URL の Map を返す (取得失敗分は含まれない)。
 */
export function useCoRunAvatars(entries: CoRunEntry[] | null): Map<string, string> {
  const [avatars, setAvatars] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    if (!entries) return
    // キャッシュ済み URL も loadCircularAvatar は即返すので、ここで除外しない。
    // (除外すると先に IslandView 等でキャッシュされた分が state に入らずアイコンが出ない)
    const urls = entries.map(e => e.photoURL).filter((u): u is string => !!u)
    if (urls.length === 0) return
    let cancelled = false
    void Promise.all(urls.map(u => loadCircularAvatar(u).then(d => [u, d] as const))).then(
      pairs => {
        if (cancelled) return
        setAvatars(prev => {
          const next = new Map(prev)
          let changed = false
          for (const [u, d] of pairs) {
            if (d && next.get(u) !== d) {
              next.set(u, d)
              changed = true
            }
          }
          return changed ? next : prev
        })
      },
    )
    return () => {
      cancelled = true
    }
  }, [entries])
  return avatars
}
