import { useEffect, useState } from 'react'
import { useMap } from './BaseMap'

export function DebugPanel() {
  const { map } = useMap()
  const [visible, setVisible] = useState(false)
  const [info, setInfo] = useState({ lng: 0, lat: 0, zoom: 0, bearing: 0, pitch: 0 })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'd' || e.key === 'D') setVisible(v => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!map) return
    const update = () => {
      const c = map.getCenter()
      setInfo({
        lng: c.lng,
        lat: c.lat,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      })
    }
    map.on('move', update)
    update()
    return () => { map.off('move', update) }
  }, [map])

  if (!visible) return null

  return (
    <div style={{
      position: 'absolute', top: 60, right: 16, zIndex: 50,
      background: 'rgba(0,0,0,0.75)', color: '#1c975e',
      fontFamily: 'monospace', fontSize: 12,
      padding: '10px 14px', borderRadius: 8,
      lineHeight: 1.8, pointerEvents: 'none',
      border: '1px solid rgba(28,151,94,0.3)',
    }}>
      <div>zoom    {info.zoom.toFixed(3)}</div>
      <div>lat     {info.lat.toFixed(6)}</div>
      <div>lng     {info.lng.toFixed(6)}</div>
      <div>bearing {info.bearing.toFixed(1)}°</div>
      <div>pitch   {info.pitch.toFixed(1)}°</div>
    </div>
  )
}
