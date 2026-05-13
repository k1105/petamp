export interface TrackPoint {
  lat: number
  lng: number
  altitude: number | null
  timestamp: number
  accuracy?: number
  altitudeAccuracy?: number | null
  heading?: number | null
  rejected?: boolean
  /** iOS 気圧計から取得した高度 (m)。kind が 'absolute' なら海抜、'relative' なら開始時点 0 基準の相対値。 */
  barometricAltitude?: number | null
  barometricKind?: 'absolute' | 'relative' | null
  /** iOS 15+ の absolute altitude のみ提供される垂直精度・分解能 (m)。 */
  barometricAccuracy?: number | null
  barometricPrecision?: number | null
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
