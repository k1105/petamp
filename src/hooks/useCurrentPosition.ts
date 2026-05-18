import { useEffect } from 'react'
import { useGpsStore, type CurrentPosition } from '../store/useGpsStore'

export type { CurrentPosition }

/**
 * 現在位置を返す。値は zustand store にキャッシュされるので、ページ再マウントで
 * 即座に前回値が返る (getCurrentPosition の取得待ちで地図表示が遅れない)。
 *
 * 未取得 (undefined) のときだけ getCurrentPosition を呼んで store を埋める。
 */
export function useCurrentPosition(): CurrentPosition | undefined {
  const position = useGpsStore(s => s.position)
  const setPosition = useGpsStore(s => s.setPosition)

  useEffect(() => {
    if (position !== undefined) return
    if (!navigator.geolocation) {
      setPosition(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => setPosition([pos.coords.longitude, pos.coords.latitude]),
      () => setPosition(null),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }, [position, setPosition])

  return position
}
