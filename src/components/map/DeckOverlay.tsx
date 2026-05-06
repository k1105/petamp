import { useEffect, useRef } from 'react'
import { MapboxOverlay } from '@deck.gl/mapbox'
import type { Layer } from '@deck.gl/core'
import { useMap } from './BaseMap'

interface DeckOverlayProps {
  layers: Layer[]
}

export function DeckOverlay({ layers }: DeckOverlayProps) {
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
