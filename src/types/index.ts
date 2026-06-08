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

/**
 * 記録の移動種別。
 * - foot: 徒歩・ランニング (by foot)
 * - bike: 自転車
 * - car:  車
 * - other: そのほか
 * 今後種別が増える可能性があるため文字列ユニオンで定義する。未保存 (過去の Run) は
 * 表示・編集時に 'foot' として扱う (= 既存ランの遅延マイグレーション)。
 */
export type MovementType = 'foot' | 'bike' | 'car' | 'other'

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
   * 記録時の移動種別。未保存 (過去の Run) は表示・編集時に 'foot' として扱う。
   * 値の解決は getMovementType() を使う。
   */
  movementType?: MovementType
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
