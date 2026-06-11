import { useEffect, useRef } from 'react'
import { useMap } from './MapContext'

export type Padding = { top: number; bottom: number; left: number; right: number }

// FAB タップで現在位置に home スケールでフォーカスする (homeGroup が無い
// = GPS が realGroup 内のケース用)。signal を increment するたびに flyTo。
export function FocusGPS({
  signal,
  center,
  zoom,
  padding,
}: {
  signal: number
  center: [number, number] | null
  zoom: number
  // 現在位置を画面中心ではなく petamp の顔(FAB)の位置に表示するための padding。
  // padding は viewport を縮めて光学的中心をずらすため、maxBounds 下でも focal point を寄せられる。
  padding: Padding
}) {
  const { map } = useMap()
  const lastRef = useRef(0)
  useEffect(() => {
    if (!map || !center || signal === 0 || signal === lastRef.current) return
    lastRef.current = signal
    map.flyTo({ center, zoom, padding, duration: 700 })
  }, [signal, map, center, zoom, padding])
  return null
}
