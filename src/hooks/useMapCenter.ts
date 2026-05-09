import { useEffect, useState } from 'react'
import { useMap } from '../components/map/BaseMap'

export function useMapCenter(): [number, number] | null {
  const { map } = useMap()
  const [center, setCenter] = useState<[number, number] | null>(null)

  useEffect(() => {
    if (!map) return
    const update = () => {
      const c = map.getCenter()
      setCenter([c.lng, c.lat])
    }
    update()
    map.on('moveend', update)
    return () => { map.off('moveend', update) }
  }, [map])

  return center
}
