import { useEffect, useRef } from 'react'
import type { GeoJSONSource, MapLayerMouseEvent } from 'mapbox-gl'
import { useMap } from './MapContext'
import type { NamedPlace } from '../../character/domain/memory'

import {
  NP_SOURCE,
  NP_LAYER_LINE,
  NP_LAYER_POINT,
  NP_LAYER_LINE_LABEL,
  NP_LAYER_POINT_LABEL,
  NP_ALL_LAYERS,
} from './namedPlaceLayerIds'

// 地名レイヤ (mapbox ネイティブ symbol)。色は地図のダークスタイル上で映える黄系。
const NP_LINE_COLOR = '#FFC83C'
const NP_DOT_COLOR = '#FFC83C'
const NP_DOT_OUTLINE = '#3C2800'
const NP_LABEL_COLOR = '#FFFFFF'
const NP_LABEL_HALO = '#1A1200'

function namedPlacesToGeoJSON(places: NamedPlace[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const p of places) {
    const properties = { id: p.id, name: p.name }
    if (p.polyline && p.polyline.length >= 2) {
      features.push({
        type: 'Feature',
        properties,
        geometry: { type: 'LineString', coordinates: p.polyline.map(n => [n.lng, n.lat]) },
      })
    }
    if (p.point) {
      features.push({
        type: 'Feature',
        properties,
        geometry: { type: 'Point', coordinates: [p.point.lng, p.point.lat] },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

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
  // click ハンドラから最新の places を引くための ref (更新は effect 内で行う)。
  const placesRef = useRef(places)

  useEffect(() => {
    if (!map) return
    // style に存在するフォントを使うため、既存 symbol レイヤの text-font を流用する。
    let textFont: string[] | undefined
    for (const l of map.getStyle()?.layers ?? []) {
      const tf = l.type === 'symbol' ? (l.layout?.['text-font'] as string[] | undefined) : undefined
      if (Array.isArray(tf)) { textFont = tf; break }
    }

    if (!map.getSource(NP_SOURCE)) {
      map.addSource(NP_SOURCE, { type: 'geojson', data: namedPlacesToGeoJSON(placesRef.current) })
    }
    if (!map.getLayer(NP_LAYER_LINE)) {
      map.addLayer({
        id: NP_LAYER_LINE,
        type: 'line',
        source: NP_SOURCE,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': NP_LINE_COLOR, 'line-width': 3, 'line-opacity': 0.9 },
      })
    }
    if (!map.getLayer(NP_LAYER_POINT)) {
      map.addLayer({
        id: NP_LAYER_POINT,
        type: 'circle',
        source: NP_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': NP_DOT_COLOR,
          'circle-stroke-color': NP_DOT_OUTLINE,
          'circle-stroke-width': 1.5,
        },
      })
    }
    if (!map.getLayer(NP_LAYER_LINE_LABEL)) {
      map.addLayer({
        id: NP_LAYER_LINE_LABEL,
        type: 'symbol',
        source: NP_SOURCE,
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: {
          'symbol-placement': 'line-center',
          'text-field': ['get', 'name'],
          'text-size': 13,
          'text-max-angle': 40,
          // 文字単位 billboard: 各グリフは線の曲線に沿って回転 (rotation=map) しつつ、
          // pitch だけ viewport にして 1 文字ずつカメラ正対で立ち上がらせる (mapbox の線ラベルと同じ)。
          'text-rotation-alignment': 'map',
          'text-pitch-alignment': 'viewport',
          ...(textFont ? { 'text-font': textFont } : {}),
        },
        paint: { 'text-color': NP_LABEL_COLOR, 'text-halo-color': NP_LABEL_HALO, 'text-halo-width': 1.5 },
      })
    }
    if (!map.getLayer(NP_LAYER_POINT_LABEL)) {
      map.addLayer({
        id: NP_LAYER_POINT_LABEL,
        type: 'symbol',
        source: NP_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        layout: {
          'symbol-placement': 'point',
          'text-field': ['get', 'name'],
          'text-size': 13,
          'text-offset': [0, -1.2],
          'text-anchor': 'bottom',
          // billboard: 常にカメラ正対・上向き。
          'text-rotation-alignment': 'viewport',
          'text-pitch-alignment': 'viewport',
          ...(textFont ? { 'text-font': textFont } : {}),
        },
        paint: { 'text-color': NP_LABEL_COLOR, 'text-halo-color': NP_LABEL_HALO, 'text-halo-width': 1.5 },
      })
    }

    const onClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id
      const place = placesRef.current.find(p => p.id === id)
      if (place) onPick(place)
    }
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer' }
    const onLeave = () => { map.getCanvas().style.cursor = '' }
    for (const id of NP_ALL_LAYERS) {
      map.on('click', id, onClick)
      map.on('mouseenter', id, onEnter)
      map.on('mouseleave', id, onLeave)
    }

    return () => {
      // 画面遷移で地図が破棄される途中だと style が無く getLayer 等が投げる。
      // ハンドラ解除は常に行い、レイヤ/source の除去は style が生きている時だけ試みる。
      for (const id of NP_ALL_LAYERS) {
        map.off('click', id, onClick)
        map.off('mouseenter', id, onEnter)
        map.off('mouseleave', id, onLeave)
      }
      try {
        if (!map.getStyle()) return
        for (const id of NP_ALL_LAYERS) {
          if (map.getLayer(id)) map.removeLayer(id)
        }
        if (map.getSource(NP_SOURCE)) map.removeSource(NP_SOURCE)
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
      const src = map.getSource(NP_SOURCE) as GeoJSONSource | undefined
      src?.setData(namedPlacesToGeoJSON(places))
    } catch {
      // 地図破棄中などは無視。
    }
  }, [map, places])

  return null
}
