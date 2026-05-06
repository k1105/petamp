import { useEffect } from 'react'
import type { Map } from 'mapbox-gl'

export function useOrbitMode(map: Map | null, enabled: boolean) {
  useEffect(() => {
    if (!map) return

    if (!enabled) {
      map.dragPan.enable()
      return
    }

    map.dragPan.disable()
    const canvas = map.getCanvas()

    // Mouse
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const startX = e.clientX
      const startY = e.clientY
      const startBearing = map.getBearing()
      const startPitch = map.getPitch()

      const onMove = (e: MouseEvent) => {
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        map.setBearing(startBearing - dx * 0.4)
        map.setPitch(Math.max(0, Math.min(85, startPitch - dy * 0.3)))
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }

    // Touch
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const startX = e.touches[0].clientX
      const startY = e.touches[0].clientY
      const startBearing = map.getBearing()
      const startPitch = map.getPitch()

      const onMove = (e: TouchEvent) => {
        if (e.touches.length !== 1) return
        const dx = e.touches[0].clientX - startX
        const dy = e.touches[0].clientY - startY
        map.setBearing(startBearing - dx * 0.4)
        map.setPitch(Math.max(0, Math.min(85, startPitch - dy * 0.3)))
      }
      const onEnd = () => {
        window.removeEventListener('touchmove', onMove)
        window.removeEventListener('touchend', onEnd)
      }
      window.addEventListener('touchmove', onMove, { passive: true })
      window.addEventListener('touchend', onEnd)
    }

    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('touchstart', onTouchStart, { passive: true })

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('touchstart', onTouchStart)
      map.dragPan.enable()
    }
  }, [map, enabled])
}
