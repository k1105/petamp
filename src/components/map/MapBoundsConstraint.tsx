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
      // No runs (yet, or none with valid coords) — skip applying constraints.
      // Don't call setMaxBounds(null): mapbox-gl 3.x converts the falsy input
      // through LngLatBounds.convert which produces (NaN, NaN) and throws.
      return
    }
    const padded = expandBboxByMeters(bbox, paddingMeters)
    const flat = [padded[0][0], padded[0][1], padded[1][0], padded[1][1]]
    if (!flat.every(Number.isFinite)) return

    const bounds = padded as unknown as LngLatBoundsLike

    map.setMaxBounds(bounds)

    if (!fittedRef.current) {
      // BaseMap was created with `bounds: padded` so the camera is already at
      // the fit zoom. Adopt that as the minZoom verbatim — using
      // cameraForBounds here can disagree by tiny fractions (pitch / rounding)
      // and would otherwise visibly jolt the camera up on first paint.
      map.setMinZoom(Math.max(0, map.getZoom()))
      fittedRef.current = true
    } else {
      // Runs changed after first apply (e.g. new recording); recompute fit
      // zoom for the (potentially expanded) bounds and re-fit instantly.
      const camera = map.cameraForBounds(bounds, { padding: 0 })
      if (camera?.zoom != null && Number.isFinite(camera.zoom)) {
        map.setMinZoom(Math.max(0, camera.zoom))
      }
      map.fitBounds(bounds, { padding: 0, duration: 0 })
    }
  }, [map, runs, paddingMeters])

  return null
}
