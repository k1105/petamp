import { useMapCenter } from '../../hooks/useMapCenter'
import { useReverseGeocode } from '../../hooks/useReverseGeocode'

export function AreaLabel() {
  const center = useMapCenter()
  const name = useReverseGeocode(center?.[0], center?.[1])
  if (!name) return null
  return <div className="area-label">{name}</div>
}
