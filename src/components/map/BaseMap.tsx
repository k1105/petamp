import { useEffect, useRef, createContext, useContext, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { Icon } from '@iconify/react'
import { useOrbitMode } from '../../hooks/useOrbitMode'
import { useActivePalette } from '../../hooks/useActivePalette'
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
  /** If supplied, map is created via the mapbox `bounds` option so the camera
      lands directly at the bbox-fit zoom and centre — avoids the "mount at
      initialZoom then snap to fit" jolt that setMinZoom triggers post-mount. */
  initialBounds?: [[number, number], [number, number]]
  /** Pixel padding for initialBounds fit. Default 0. */
  initialBoundsPadding?: number
  /** Max zoom for initialBounds fit. */
  initialBoundsMaxZoom?: number
  lockTarget?: boolean   // orbit-only, no pan toggle shown
  mapVisible?: boolean   // hide/show mapbox canvas
  /** When false, all user interactions (pan/zoom/rotate) are disabled and
      the orbit toggle is hidden. Camera is controlled programmatically only. */
  interactive?: boolean
}

export function BaseMap({
  children,
  initialCenter = [139.6503, 35.6762],
  initialZoom = 14,
  initialBounds,
  initialBoundsPadding,
  initialBoundsMaxZoom,
  lockTarget = false,
  mapVisible = true,
  interactive = true,
}: BaseMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<mapboxgl.Map | null>(null)
  const [orbitMode, setOrbitMode] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const { palette } = useActivePalette()

  useOrbitMode(map, interactive && (lockTarget || orbitMode))

  useEffect(() => {
    if (!map) return
    if (interactive) return
    map.dragPan.disable()
    map.scrollZoom.disable()
    map.doubleClickZoom.disable()
    map.touchZoomRotate.disable()
    map.dragRotate.disable()
    map.keyboard.disable()
    map.boxZoom.disable()
    return () => {
      map.dragPan.enable()
      map.scrollZoom.enable()
      map.doubleClickZoom.enable()
      map.touchZoomRotate.enable()
      map.dragRotate.enable()
      map.keyboard.enable()
      map.boxZoom.enable()
    }
  }, [map, interactive])

  useEffect(() => {
    if (!containerRef.current) return

    const opts: mapboxgl.MapOptions = {
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      pitch: 45,
      antialias: true,
    }
    if (initialBounds) {
      opts.bounds = initialBounds
      opts.fitBoundsOptions = {
        padding: initialBoundsPadding ?? 0,
        maxZoom: initialBoundsMaxZoom,
      }
    } else {
      opts.center = initialCenter
      opts.zoom = initialZoom
    }
    const m = new mapboxgl.Map(opts)

    m.on('load', () => {
      const layers = m.getStyle()?.layers ?? []
      for (const layer of layers) {
        if (layer.type !== 'symbol') {
          m.setLayoutProperty(layer.id, 'visibility', 'none')
        }
      }
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

  // テーマ変更を mapbox の fog / space に反映する (すべて単色)。
  useEffect(() => {
    if (!map) return
    map.setFog({
      range: [0.1, 2],
      color: palette.bg,
      'high-color': palette.bg,
      'space-color': palette.bg,
      'horizon-blend': 0.3,
    })
  }, [map, palette.bg])

  return (
    <MapContext.Provider value={{ map }}>
      <div
        ref={containerRef}
        className="map-canvas"
        style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.4s' }}
      />
      {!lockTarget && interactive && (
        <button
          className={`orbit-toggle ${orbitMode ? 'orbit-toggle-active' : ''}`}
          onClick={() => setOrbitMode(v => !v)}
          title={orbitMode ? 'パンモード' : '回転モード'}
          aria-label={orbitMode ? 'パンモード' : '回転モード'}
        >
          <Icon icon={orbitMode ? 'lucide:rotate-3d' : 'lucide:move'} />
        </button>
      )}
      {map && <><DebugPanel />{children}</>}
    </MapContext.Provider>
  )
}
