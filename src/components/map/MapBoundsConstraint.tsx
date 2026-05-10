import { useEffect, useRef } from 'react'
import type { LngLatBoundsLike } from 'mapbox-gl'
import { useMap } from './BaseMap'
import { expandBboxByMeters, type LngLatBbox } from '../../utils/runBbox'

interface Props {
  /** Pre-computed bbox of the current group (or null if none). Already in
      sw/ne order; will be expanded internally by paddingMeters. */
  bbox: LngLatBbox | null
  paddingMeters: number
  /** ms — group switch animation length. 0 = instant snap. */
  transitionMs?: number
  /** Fixed minZoom override (for the home pseudo-group). When supplied,
      `cameraForBounds` is ignored and minZoom is locked to this value. */
  fixedMinZoom?: number
}

const DEFAULT_TRANSITION_MS = 700

function unionBbox(a: LngLatBbox, b: LngLatBbox): LngLatBbox {
  return [
    [Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1])],
    [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1])],
  ]
}

/**
 * Restricts panning to the supplied bbox + padding and clamps zoom-out to
 * what fits that bbox in the viewport. The bbox itself is computed by the
 * caller — Phase 1 passed the all-runs union, Phase 2+ passes the currently-
 * selected group's bbox so switching groups updates the constraint.
 *
 * Group switch transition: maxBounds is temporarily widened to the
 * old∪new bbox (and minZoom dropped) so `fitBounds` can animate the camera
 * across the gap. On `moveend` the constraints are re-tightened to the new
 * group only.
 */
export function MapBoundsConstraint({
  bbox,
  paddingMeters,
  transitionMs = DEFAULT_TRANSITION_MS,
  fixedMinZoom,
}: Props) {
  const { map } = useMap()
  const fittedRef = useRef(false)
  const lastPaddedRef = useRef<LngLatBbox | null>(null)

  useEffect(() => {
    if (!map || !bbox) return
    const padded = expandBboxByMeters(bbox, paddingMeters)
    const flat = [padded[0][0], padded[0][1], padded[1][0], padded[1][1]]
    if (!flat.every(Number.isFinite)) return

    const newBounds = padded as unknown as LngLatBoundsLike

    if (!fittedRef.current) {
      // First apply: BaseMap was created with `bounds: padded` (or with
      // initialZoom when home), camera is already at the fit position. Lock
      // the constraint without animating.
      map.setMaxBounds(newBounds)
      map.setMinZoom(
        fixedMinZoom != null ? fixedMinZoom : Math.max(0, map.getZoom()),
      )
      fittedRef.current = true
      lastPaddedRef.current = padded
      return
    }

    const prevPadded = lastPaddedRef.current
    const prevKey = prevPadded ? prevPadded.flat().join(',') : ''
    const newKey = flat.join(',')
    if (prevKey === newKey) return // bbox unchanged, nothing to do
    lastPaddedRef.current = padded

    let newMinZoom: number
    if (fixedMinZoom != null) {
      newMinZoom = fixedMinZoom
    } else {
      const newCamera = map.cameraForBounds(newBounds, { padding: 0 })
      newMinZoom =
        newCamera?.zoom != null && Number.isFinite(newCamera.zoom)
          ? Math.max(0, newCamera.zoom)
          : 0
    }

    // Temporarily widen the cage so fitBounds can move the camera across the
    // gap between groups instead of being clamped at the old edge.
    const transitBbox = prevPadded ? unionBbox(prevPadded, padded) : padded
    map.setMaxBounds(transitBbox as unknown as LngLatBoundsLike)
    map.setMinZoom(0)

    map.fitBounds(newBounds, { padding: 0, duration: transitionMs })
    map.once('moveend', () => {
      map.setMaxBounds(newBounds)
      map.setMinZoom(newMinZoom)
    })
  }, [map, bbox, paddingMeters, transitionMs])

  return null
}
