import { get, set, del } from 'idb-keyval'
import type { TrackPoint, MovementType } from '../types'

// 走行中ランの下書き (1 件のみ)。アプリが強制終了/クラッシュしても
// 次回起動で復元できるよう、記録中に逐次保存する。
// key は 'run:' で始めないこと (runRepository.listRuns が拾ってしまうため)。
const KEY = 'inProgressRun'

export interface InProgressRun {
  id: string
  startedAt: number
  /** 最終保存時刻 (診断・表示用)。 */
  updatedAt: number
  /** 採用済み (rejected を含まない) 軌跡。 */
  trackPoints: TrackPoint[]
  movementType: MovementType
}

export async function saveInProgressRun(draft: InProgressRun): Promise<void> {
  await set(KEY, draft)
}

export async function loadInProgressRun(): Promise<InProgressRun | undefined> {
  return get<InProgressRun>(KEY)
}

export async function clearInProgressRun(): Promise<void> {
  await del(KEY)
}
