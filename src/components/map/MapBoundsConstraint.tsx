import { useEffect, useRef } from 'react'
import type { LngLatBoundsLike } from 'mapbox-gl'
import { useMap } from './BaseMap'
import { computeRunsBbox, expandBboxByMeters } from '../../utils/runBbox'
import type { Run } from '../../types'

interface Props {
  runs: Run[]
  paddingMeters: number
}

/**
 * Restricts panning to the union bbox of all runs (+ padding) and clamps zoom-out
 * so the user can never see beyond the recorded area. First time the bbox is
 * computable, also fitBounds so the camera lands on the run area instead of
 * staying at GPS-current-location (which may be outside).
 *
 * Phase 1: single-group constraint (= union of all runs). Group-aware version
 * (per-cluster bounds + jump-on-edge) lives in run-grouping.md as the Phase 2
 * design.
 */
export function MapBoundsConstraint({ runs, paddingMeters }: Props) {
  const { map } = useMap()
  const fittedRef = useRef(false)

  useEffect(() => {
    if (!map) return
    const bbox = computeRunsBbox(runs)
    if (!bbox) {
      // No runs yet — leave camera unconstrained.
      map.setMaxBounds(undefined)
      map.setMinZoom(undefined)
      return
    }
    const padded = expandBboxByMeters(bbox, paddingMeters)
    const bounds = padded as unknown as LngLatBoundsLike

    map.setMaxBounds(bounds)
    const camera = map.cameraForBounds(bounds, { padding: 0 })
    if (camera?.zoom != null) {
      map.setMinZoom(Math.max(0, camera.zoom))
    }

    // First successful constraint apply: snap the camera onto the area so the
    // initial GPS-anchored center doesn't leave the user staring at an arbitrary
    // edge clamp. Subsequent run additions only update the constraint.
    if (!fittedRef.current) {
      map.fitBounds(bounds, { padding: 0, duration: 0 })
      fittedRef.current = true
    }
  }, [map, runs, paddingMeters])

  return null
}
