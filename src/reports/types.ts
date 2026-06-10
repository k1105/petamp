import type { CharacterId } from '../character/domain/character'
import type { DialogueTurn, ThreadId, TurnId } from '../character/domain/dialogue'
import type { PersistNameProposalResult } from '../character/logs/promptLog'

type ReportId = string

interface ReportClientInfo {
  userAgent: string
  appVersion: string
  platform: 'web' | 'capacitor'
  locationPath: string
}

export interface Report {
  id: ReportId
  uid: string
  characterId: CharacterId
  threadId: ThreadId
  createdAt: number
  message: string
  selectedTurnIds: TurnId[]
  turns: DialogueTurn[]
  client: ReportClientInfo
  /**
   * このスレッドの命名(nameProposal)永続化結果。報告時点で対話が締まっていれば付く。
   * 「命名処理が走って正常に保存されたか」をリモートから確認するためのログ。
   * outcome: 'created'/'refined'=保存成功, 'skipped'=理由つきスキップ, 'none'=命名なし。
   * close 前(対話途中)に報告した場合は null。
   */
  naming?: PersistNameProposalResult | null
}
