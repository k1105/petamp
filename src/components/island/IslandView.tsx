import { useEffect, useMemo, useState } from 'react'
import { COORDINATE_SYSTEM, type Layer } from '@deck.gl/core'
import { TextLayer } from '@deck.gl/layers'
import type { Run } from '../../types'
import { computeArchipelagoLayout, DEFAULT_ARCHIPELAGO_PARAMS } from '../../utils/archipelagoLayout'
import { buildTerrainLayers } from '../../utils/terrainShared'
import { fetchAreaName } from '../../hooks/useReverseGeocode'
import { useActivePalette } from '../../hooks/useActivePalette'
import { hexToRgb } from '../../utils/themePalettes'
import { ArchipelagoMapView, type ArchipelagoBbox } from './ArchipelagoMapView'

interface Props {
  runs: Run[]
}

export function IslandView({ runs }: Props) {
  const { palette } = useActivePalette()
  const seaColor = useMemo<[number, number, number]>(() => hexToRgb(palette.bg), [palette.bg])
  const layout = useMemo(() => computeArchipelagoLayout(runs), [runs])

  // 各グループの地理的中心から area name を逐次解決する。
  const [groupNames, setGroupNames] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    if (!layout) return
    let cancelled = false
    const next = new Map<string, string>()
    Promise.all(
      layout.groups.map(async (g) => {
        const name = await fetchAreaName(g.geographicCenter.lng, g.geographicCenter.lat)
        if (name) next.set(g.id, name)
      }),
    ).then(() => {
      if (!cancelled) setGroupNames(next)
    })
    return () => { cancelled = true }
  }, [layout])

  const layers = useMemo<Layer[]>(() => {
    if (!layout) return []
    const params = { ...DEFAULT_ARCHIPELAGO_PARAMS, seaColor }
    const terrainLayers = buildTerrainLayers({
      islands: layout.islands,
      origin: layout.origin,
      mPerDegLng: layout.mPerDegLng,
      mPerDegLat: layout.mPerDegLat,
      bounds: layout.bounds,
      params,
      idPrefix: 'island',
    })

    const coordinateOrigin: [number, number, number] = [layout.origin.lng, layout.origin.lat, 0]
    const islandLabels = layout.groups
      .map((g) => {
        const text = groupNames.get(g.id)
        if (!text) return null
        const labelZ = Math.max(0, g.maxAlt) * params.zScale + 30
        return {
          position: [g.center.x, g.center.y, labelZ] as [number, number, number],
          text,
        }
      })
      .filter((d): d is { position: [number, number, number]; text: string } => d !== null)

    const labelLayers: Layer[] = islandLabels.length > 0
      ? [
          new TextLayer({
            id: 'island:label',
            data: islandLabels,
            getPosition: (d) => d.position,
            getText: (d) => d.text,
            getSize: 16,
            getColor: [255, 255, 255, 255],
            fontWeight: 'bold',
            background: false,
            billboard: true,
            sizeUnits: 'pixels',
            characterSet: 'auto',
            coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
            coordinateOrigin,
          }),
        ]
      : []

    return [...terrainLayers, ...labelLayers]
  }, [layout, groupNames, seaColor])

  const fitBbox = useMemo<ArchipelagoBbox | null>(() => {
    if (!layout) return null
    const { origin, mPerDegLng, mPerDegLat, bounds } = layout
    return {
      minLng: origin.lng + bounds.minX / mPerDegLng,
      maxLng: origin.lng + bounds.maxX / mPerDegLng,
      minLat: origin.lat + bounds.minY / mPerDegLat,
      maxLat: origin.lat + bounds.maxY / mPerDegLat,
    }
  }, [layout])

  return <ArchipelagoMapView layers={layers} fitBbox={fitBbox} background={palette.bg} />
}
