import type { GeoJSONSource, Map as MapboxMap, MapLayerMouseEvent } from 'mapbox-gl'
import type { NamedPlace } from '../../character/domain/memory'

const LINE_COLOR = '#FFC83C'
const DOT_COLOR = '#FFC83C'
const DOT_OUTLINE = '#3C2800'
const LABEL_COLOR = '#FFFFFF'
const LABEL_HALO = '#1A1200'

const SOURCE_ID = 'named-places'
const LAYER_LINE = 'named-place-line'
const LAYER_POINT = 'named-place-point'
const LAYER_LINE_LABEL = 'named-place-line-label'
const LAYER_POINT_LABEL = 'named-place-point-label'
const LAYER_IDS = [LAYER_LINE, LAYER_POINT, LAYER_LINE_LABEL, LAYER_POINT_LABEL] as const

function namedPlacesToGeoJSON(places: NamedPlace[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const place of places) {
    const properties = { id: place.id, name: place.name }
    if (place.polyline && place.polyline.length >= 2) {
      features.push({
        type: 'Feature',
        properties,
        geometry: { type: 'LineString', coordinates: place.polyline.map(n => [n.lng, n.lat]) },
      })
    }
    if (place.point) {
      features.push({
        type: 'Feature',
        properties,
        geometry: { type: 'Point', coordinates: [place.point.lng, place.point.lat] },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

function findTextFont(map: MapboxMap): string[] | undefined {
  for (const layer of map.getStyle()?.layers ?? []) {
    const textFont = layer.type === 'symbol'
      ? (layer.layout?.['text-font'] as string[] | undefined)
      : undefined
    if (Array.isArray(textFont)) return textFont
  }
  return undefined
}

export function addNamedPlaceLayers(map: MapboxMap, places: NamedPlace[]): void {
  const textFont = findTextFont(map)

  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: 'geojson', data: namedPlacesToGeoJSON(places) })
  }
  if (!map.getLayer(LAYER_LINE)) {
    map.addLayer({
      id: LAYER_LINE,
      type: 'line',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': LINE_COLOR, 'line-width': 3, 'line-opacity': 0.9 },
    })
  }
  if (!map.getLayer(LAYER_POINT)) {
    map.addLayer({
      id: LAYER_POINT,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 5,
        'circle-color': DOT_COLOR,
        'circle-stroke-color': DOT_OUTLINE,
        'circle-stroke-width': 1.5,
      },
    })
  }
  if (!map.getLayer(LAYER_LINE_LABEL)) {
    map.addLayer({
      id: LAYER_LINE_LABEL,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: {
        'symbol-placement': 'line-center',
        'text-field': ['get', 'name'],
        'text-size': 13,
        'text-max-angle': 40,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
        ...(textFont ? { 'text-font': textFont } : {}),
      },
      paint: { 'text-color': LABEL_COLOR, 'text-halo-color': LABEL_HALO, 'text-halo-width': 1.5 },
    })
  }
  if (!map.getLayer(LAYER_POINT_LABEL)) {
    map.addLayer({
      id: LAYER_POINT_LABEL,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: {
        'symbol-placement': 'point',
        'text-field': ['get', 'name'],
        'text-size': 13,
        'text-offset': [0, -1.2],
        'text-anchor': 'bottom',
        'text-rotation-alignment': 'viewport',
        'text-pitch-alignment': 'viewport',
        ...(textFont ? { 'text-font': textFont } : {}),
      },
      paint: { 'text-color': LABEL_COLOR, 'text-halo-color': LABEL_HALO, 'text-halo-width': 1.5 },
    })
  }
}

export function updateNamedPlaceSource(map: MapboxMap, places: NamedPlace[]): void {
  const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
  source?.setData(namedPlacesToGeoJSON(places))
}

export function removeNamedPlaceLayers(map: MapboxMap): void {
  for (const id of LAYER_IDS) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
}

export function subscribeNamedPlaceInteractions(
  map: MapboxMap,
  onPickId: (id: string) => void,
): () => void {
  const onClick = (event: MapLayerMouseEvent) => {
    const id = event.features?.[0]?.properties?.id
    if (typeof id === 'string') onPickId(id)
  }
  const onEnter = () => { map.getCanvas().style.cursor = 'pointer' }
  const onLeave = () => { map.getCanvas().style.cursor = '' }

  for (const id of LAYER_IDS) {
    map.on('click', id, onClick)
    map.on('mouseenter', id, onEnter)
    map.on('mouseleave', id, onLeave)
  }

  return () => {
    for (const id of LAYER_IDS) {
      map.off('click', id, onClick)
      map.off('mouseenter', id, onEnter)
      map.off('mouseleave', id, onLeave)
    }
  }
}

export function hasRenderedNamedPlaceAtPoint(map: MapboxMap, point: [number, number]): boolean {
  const visibleLayerIds = LAYER_IDS.filter(id => map.getLayer(id))
  return visibleLayerIds.length > 0
    && map.queryRenderedFeatures(point, { layers: visibleLayerIds }).length > 0
}
