import { useCallback, useEffect, useState } from 'react'
import { getMemoryStore, petampCharacter } from '../character'
import type { NamedPlace } from '../character/domain/memory'

/**
 * キャラの現役 NamedPlace (refine chain の末端) を読み込んで保持する。
 * - マウント時に 1 回 query
 * - 外部 (対話完了など) でストアが更新されたあとは `refresh()` を呼ぶ
 * - 認証同期等で全件入れ替わるユースケースは出る前に refresh されるはず
 */
export function useNamedPlaces(): {
  places: NamedPlace[]
  refresh: () => Promise<void>
} {
  const [places, setPlaces] = useState<NamedPlace[]>([])

  const refresh = useCallback(async () => {
    const store = getMemoryStore()
    const all = await store.queryNamedPlaces({
      characterId: petampCharacter.id,
      currentOnly: true,
    })
    setPlaces(all)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  return { places, refresh }
}
