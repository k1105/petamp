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
  /** 記録時の天気。未保存 (過去の Run) は表示時に 'sunny' として扱う。 */
  weather?: 'sunny' | 'cloudy' | 'rainy'
  /**
   * フォロー中ユーザーのランをローカルに表示するときに付与される uid。
   * 自分自身のランでは undefined。Firestore には保存しない (受信時に組み立て)。
   */
  ownerUid?: string
  /**
   * 「一緒に走る」セッションで保存されたランに付く session id。
   * 同一 coRunSessionId のラン (自分 + 相手) は一覧で 1 タイルに統合し、合成リプレイする。
   * Firestore にも保存する (相手の端末・後日の再生で参照するため)。
   */
  coRunSessionId?: string
  /**
   * co-run 参加者の表示名スナップショット。フォロー情報が無くても
   * タイル/リプレイで名前を出せるよう、保存時に固定する。
   */
  coRunParticipants?: { uid: string; displayName: string | null }[]
}
