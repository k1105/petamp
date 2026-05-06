import { useEffect, useRef, createContext, useContext, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useOrbitMode } from '../../hooks/useOrbitMode'
import { DebugPanel } from './DebugPanel'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

interface MapContextValue {
  map: mapboxgl.Map | null
}

const MapContext = createContext<MapContextValue>({ map: null })

export function useMap() {
  return useContext(MapContext)
}

export function useMapZoom(minZoom = 0): number {
  const { map } = useContext(MapContext)
  const [zoom, setZoom] = useState(() => map?.getZoom() ?? minZoom)

  useEffect(() => {
    if (!map) return
    const update = () => setZoom(map.getZoom())
    map.on('zoom', update)
    setZoom(map.getZoom())
    return () => { map.off('zoom', update) }
  }, [map])

  return zoom
}

interface BaseMapProps {
  children?: React.ReactNode
  initialCenter?: [number, number]
  initialZoom?: number
  lockTarget?: boolean   // orbit-only, no pan toggle shown
  mapVisible?: boolean   // hide/show mapbox canvas
}

export function BaseMap({
  children,
  initialCenter = [139.6503, 35.6762],
  initialZoom = 14,
  lockTarget = false,
  mapVisible = true,
}: BaseMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<mapboxgl.Map | null>(null)
  const [orbitMode, setOrbitMode] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useOrbitMode(map, lockTarget || orbitMode)

  useEffect(() => {
    if (!containerRef.current) return

    const m = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: initialCenter,
      zoom: initialZoom,
      pitch: 45,
      antialias: true,
    })

    m.on('load', () => {
      const layers = m.getStyle()?.layers ?? []
      for (const layer of layers) {
        if (layer.type !== 'symbol') {
          m.setLayoutProperty(layer.id, 'visibility', 'none')
        }
      }
      m.setFog({
        range: [0.1, 2],
        color: '#0a0a0a',
        'high-color': '#0a0a0a',
        'space-color': '#0a0a0a',
        'horizon-blend': 0.3,
      })
      setMap(m)
      setLoaded(true)
    })

    return () => {
      m.remove()
      setMap(null)
    }
  }, [])

  // Mapboxキャンバスだけを隠す（deck.glキャンバスは別要素なので影響しない）
  useEffect(() => {
    if (!map) return
    const canvas = map.getCanvas()
    canvas.style.opacity = mapVisible ? '1' : '0'
    canvas.style.transition = 'opacity 0.4s'
  }, [map, mapVisible])

  return (
    <MapContext.Provider value={{ map }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', opacity: loaded ? 1 : 0, transition: 'opacity 0.4s' }}
      />
      {!lockTarget && (
        <button
          className={`orbit-toggle ${orbitMode ? 'orbit-toggle-active' : ''}`}
          onClick={() => setOrbitMode(v => !v)}
          title={orbitMode ? 'パンモード' : '回転モード'}
        >
          {orbitMode ? '↻' : '⊕'}
        </button>
      )}
      {map && <><DebugPanel />{children}</>}
    </MapContext.Provider>
  )
}
