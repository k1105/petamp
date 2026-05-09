import { useMapCenter } from '../../hooks/useMapCenter'
import { useReverseGeocode } from '../../hooks/useReverseGeocode'

interface Props {
  override?: string
}

export function AreaLabel({ override }: Props) {
  const center = useMapCenter()
  const fetched = useReverseGeocode(
    override ? null : center?.[0],
    override ? null : center?.[1],
  )
  const name = override ?? fetched
  if (!name) return null
  return <div className="area-label">{name}</div>
}
