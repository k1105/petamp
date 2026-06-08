import type { MovementType, Run } from '../types'

/** 未保存 (過去の Run) のデフォルト移動種別。既存ランの遅延マイグレーションに使う。 */
export const DEFAULT_MOVEMENT_TYPE: MovementType = 'foot'

export interface MovementTypeMeta {
  value: MovementType
  label: string
  /** @iconify アイコン名 (lucide)。 */
  icon: string
}

/**
 * 移動種別の選択肢 (記録画面のセレクタ・編集シート共通)。
 * 徒歩とランニングは区別せず "by foot" (足) としてまとめる。順序は 2x2 グリッドの並び。
 */
export const MOVEMENT_TYPES: readonly MovementTypeMeta[] = [
  { value: 'foot', label: '徒歩・ラン', icon: 'lucide:footprints' },
  { value: 'bike', label: '自転車', icon: 'lucide:bike' },
  { value: 'car', label: '車', icon: 'lucide:car' },
  { value: 'other', label: 'そのほか', icon: 'lucide:circle-ellipsis' },
]

/** Run の移動種別を解決する。未設定 (過去の Run) は 'foot' を返す。 */
export function getMovementType(run: Pick<Run, 'movementType'>): MovementType {
  return run.movementType ?? DEFAULT_MOVEMENT_TYPE
}

/** 移動種別のメタ情報を取得する。未知の値はデフォルト (foot) にフォールバックする。 */
export function movementTypeMeta(type: MovementType): MovementTypeMeta {
  return MOVEMENT_TYPES.find(m => m.value === type) ?? MOVEMENT_TYPES[0]
}
