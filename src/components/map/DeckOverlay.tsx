import { useEffect, useRef } from 'react'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { Deck, MapView } from '@deck.gl/core'
import type { Layer, MapViewState } from '@deck.gl/core'
import { useMap } from './BaseMap'

interface DeckOverlayProps {
  layers: Layer[]
  /**
   * 'mapbox' (default): deck.gl を MapboxOverlay として mapbox の canvas 配下に
   *   重ねる。.map-canvas の mask/inset の影響を受ける (= 縁で fade)。
   * 'fullscreen': deck.gl を独自の全画面 div に描画する。mask/inset を回避できる。
   *   mapbox の view state を毎フレーム同期。pitch != 0 では aspect 違いで mapbox
   *   タイルとは若干ズレるが、map 非表示時はタイルが見えないので問題にならない。
   */
  mode?: 'mapbox' | 'fullscreen'
}

export function DeckOverlay({ layers, mode = 'mapbox' }: DeckOverlayProps) {
  if (mode === 'fullscreen') return <FullscreenDeck layers={layers} />
  return <MapboxDeck layers={layers} />
}

function MapboxDeck({ layers }: { layers: Layer[] }) {
  const { map } = useMap()
  const overlayRef = useRef<MapboxOverlay | null>(null)

  useEffect(() => {
    if (!map) return
    const overlay = new MapboxOverlay({ interleaved: false, layers, pickingRadius: 12 })
    map.addControl(overlay as unknown as mapboxgl.IControl)
    overlayRef.current = overlay

    return () => {
      map.removeControl(overlay as unknown as mapboxgl.IControl)
      overlayRef.current = null
    }
  }, [map])

  useEffect(() => {
    overlayRef.current?.setProps({ layers })
  }, [layers])

  return null
}

function FullscreenDeck({ layers }: { layers: Layer[] }) {
  const { map } = useMap()
  const containerRef = useRef<HTMLDivElement>(null)
  // deck.gl の Deck 型が generic でややこしいので unknown で保持
  const deckRef = useRef<{ setProps: (p: object) => void; finalize: () => void } | null>(null)

  useEffect(() => {
    if (!map || !containerRef.current) return
    const getViewState = (): MapViewState => {
      const c = map.getCenter()
      return {
        longitude: c.lng,
        latitude: c.lat,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      }
    }
    const deck = new Deck({
      parent: containerRef.current,
      views: [new MapView({ id: 'map' })],
      initialViewState: { map: getViewState() },
      viewState: { map: getViewState() },
      controller: false,
      layers,
    } as never)
    deckRef.current = deck as unknown as { setProps: (p: object) => void; finalize: () => void }
    const onMove = () => deck.setProps({ viewState: { map: getViewState() } } as never)
    map.on('move', onMove)
    return () => {
      map.off('move', onMove)
      deck.finalize()
      deckRef.current = null
    }
  }, [map])

  useEffect(() => {
    deckRef.current?.setProps({ layers })
  }, [layers])

  return <div ref={containerRef} className="deck-fullscreen" />
}
