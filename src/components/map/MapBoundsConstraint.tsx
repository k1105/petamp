import { useEffect, useRef } from 'react'
import type { LngLatBoundsLike } from 'mapbox-gl'
import { useMap } from './BaseMap'
import { expandBboxByMeters, type LngLatBbox } from '../../utils/runBbox'

interface Props {
  /** Pre-computed bbox of the current group (or null if none). Already in
      sw/ne order; will be expanded internally by paddingMeters. */
  bbox: LngLatBbox | null
  paddingMeters: number
}

/**
 * Restricts panning to the supplied bbox + padding and clamps zoom-out to
 * what fits that bbox in the viewport. The bbox itself is computed by the
 * caller — Phase 1 passed the all-runs union, Phase 2+ passes the currently-
 * selected group's bbox so switching groups updates the constraint.
 */
export function MapBoundsConstraint({ bbox, paddingMeters }: Props) {
  const { map } = useMap()
  const fittedRef = useRef(false)
  const lastBboxKeyRef = useRef<string>('')

  useEffect(() => {
    if (!map || !bbox) return
    const padded = expandBboxByMeters(bbox, paddingMeters)
    const flat = [padded[0][0], padded[0][1], padded[1][0], padded[1][1]]
    if (!flat.every(Number.isFinite)) return

    const bounds = padded as unknown as LngLatBoundsLike
    const key = flat.join(',')
    const bboxChanged = key !== lastBboxKeyRef.current
    lastBboxKeyRef.current = key

    map.setMaxBounds(bounds)

    if (!fittedRef.current) {
      // BaseMap was created with `bounds: padded` so the camera is already at
      // the fit zoom. Adopt that as minZoom verbatim — cameraForBounds here
      // can disagree by tiny fractions (pitch / rounding) and would otherwise
      // visibly jolt the camera up on first paint.
      map.setMinZoom(Math.max(0, map.getZoom()))
      fittedRef.current = true
    } else if (bboxChanged) {
      // Group switched (or runs expanded the current group's bbox). Recompute
      // the fit zoom and snap there.
      const camera = map.cameraForBounds(bounds, { padding: 0 })
      if (camera?.zoom != null && Number.isFinite(camera.zoom)) {
        map.setMinZoom(Math.max(0, camera.zoom))
      }
      map.fitBounds(bounds, { padding: 0, duration: 0 })
    }
  }, [map, bbox, paddingMeters])

  return null
}
