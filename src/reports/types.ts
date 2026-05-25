import type { CharacterId } from '../character/domain/character'
import type { DialogueTurn, ThreadId, TurnId } from '../character/domain/dialogue'

export type ReportId = string

export interface ReportClientInfo {
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
}
