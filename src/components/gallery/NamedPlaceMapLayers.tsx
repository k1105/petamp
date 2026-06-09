import { useEffect, useRef } from 'react'
import { useMap } from '../map/MapContext'
import {
  addNamedPlaceLayers,
  removeNamedPlaceLayers,
  subscribeNamedPlaceInteractions,
  updateNamedPlaceSource,
} from '../../lib/mapbox/namedPlaces'
import type { NamedPlace } from '../../character/domain/memory'

/**
 * 地名 (NamedPlace) を mapbox ネイティブの symbol レイヤで描く。
 *
 * 自前の 1 文字配置 (deck TextLayer) はカーニングがズーム依存になり線追従もガタつくため、
 * 地図と同じ仕組み = SDF グリフ + `symbol-placement: 'line'` の symbol レイヤに任せる。
 * px 基準で字間・サイズが一定、曲線追従・縁取り(halo)・衝突回避も内蔵。日本語は
 * mapbox の `localIdeographFontFamily` (BaseMap で設定) によりローカル描画される。
 * タップ→popup は mapbox の layer 付き click で取得する。
 */
export function NamedPlaceMapLayers({
  places,
  onPick,
}: {
  places: NamedPlace[]
  onPick: (place: NamedPlace) => void
}) {
  const { map } = useMap()
  const placesRef = useRef(places)

  useEffect(() => {
    if (!map) return
    addNamedPlaceLayers(map, placesRef.current)
    const unsubscribe = subscribeNamedPlaceInteractions(map, (id) => {
      const place = placesRef.current.find(p => p.id === id)
      if (place) onPick(place)
    })

    return () => {
      unsubscribe()
      try {
        if (!map.getStyle()) return
        removeNamedPlaceLayers(map)
      } catch {
        // 地図破棄中は何もしない (map.remove() がまとめて片付ける)。
      }
    }
    // onPick は安定参照。places は下の effect で setData 更新する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  useEffect(() => {
    placesRef.current = places
    if (!map) return
    try {
      if (!map.getStyle()) return
      updateNamedPlaceSource(map, places)
    } catch {
      // 地図破棄中などは無視。
    }
  }, [map, places])

  return null
}
