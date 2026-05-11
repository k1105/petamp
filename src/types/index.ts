export interface TrackPoint {
  lat: number
  lng: number
  altitude: number | null
  timestamp: number
  accuracy?: number
  altitudeAccuracy?: number | null
  heading?: number | null
  rejected?: boolean
}

export interface Note {
  id: string
  lat: number
  lng: number
  altitude: number | null
  timestamp: number
  text?: string
  photoDataUrl?: string
}

export interface Run {
  id: string
  name: string
  startedAt: number
  finishedAt: number
  trackPoints: TrackPoint[]
  notes: Note[]
  areaName?: string
}
