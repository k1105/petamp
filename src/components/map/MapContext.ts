import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Map as MapboxMap } from 'mapbox-gl'

interface MapContextValue {
  map: MapboxMap | null
}

export const MapContext = createContext<MapContextValue>({ map: null })

export function useMap() {
  return useContext(MapContext)
}

export function useMapZoom(minZoom = 0): number {
  const { map } = useContext(MapContext)
  return useSyncExternalStore(
    (callback) => {
      if (!map) return () => {}
      map.on('zoom', callback)
      return () => { map.off('zoom', callback) }
    },
    () => map?.getZoom() ?? minZoom,
    () => minZoom,
  )
}
