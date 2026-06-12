import type { TrackPoint } from '../../types'

export interface GeoBBox { lngMin: number; lngMax: number; latMin: number; latMax: number }
export interface FitTarget { x: number; y: number; w: number; h: number }

export function computeBBox(pts: TrackPoint[]): GeoBBox | null {
  if (pts.length === 0) return null
  let lngMin = Infinity, lngMax = -Infinity, latMin = Infinity, latMax = -Infinity
  for (const p of pts) {
    if (p.lng < lngMin) lngMin = p.lng
    if (p.lng > lngMax) lngMax = p.lng
    if (p.lat < latMin) latMin = p.lat
    if (p.lat > latMax) latMax = p.lat
  }
  return { lngMin, lngMax, latMin, latMax }
}

// 軌跡の bbox を target 矩形内に等比フィット。緯度方向の歪みを cosLat で軽く補正。
export function makeProjector(bbox: GeoBBox, target: FitTarget) {
  const bw = bbox.lngMax - bbox.lngMin || 1e-9
  const bh = bbox.latMax - bbox.latMin || 1e-9
  const cosLat = Math.cos(((bbox.latMin + bbox.latMax) / 2) * Math.PI / 180)
  const scaledBw = bw * cosLat
  const aspectPath = scaledBw / bh
  const aspectTarget = target.w / target.h
  let drawW: number, drawH: number
  if (aspectPath > aspectTarget) {
    drawW = target.w
    drawH = target.w / aspectPath
  } else {
    drawH = target.h
    drawW = target.h * aspectPath
  }
  const ox = target.x + (target.w - drawW) / 2
  const oy = target.y + (target.h - drawH) / 2
  return (lng: number, lat: number): [number, number] => {
    const nx = ((lng - bbox.lngMin) * cosLat) / scaledBw
    const ny = 1 - (lat - bbox.latMin) / bh
    return [ox + nx * drawW, oy + ny * drawH]
  }
}
