import type { CharacterId } from './character'

export type ThreadId = string
export type TurnId = string

export type TurnRole = 'user' | 'character'

export interface DialogueTurn {
  id: TurnId
  threadId: ThreadId
  role: TurnRole
  /** ユーザ入力 / キャラの最終発話(say)。thoughtはここには含めない(ログ側に残す)。 */
  content: string
  timestamp: number
  /** このターンが言及している外部オブジェクトへの参照。 */
  refs?: TurnRef[]
}

export interface TurnRef {
  kind: 'run' | 'note' | 'area'
  id: string
}

export interface DialogueThread {
  id: ThreadId
  characterId: CharacterId
  /** きっかけになった文脈(Run詳細画面で開いた等)。 */
  origin?: TurnRef
  startedAt: number
  lastTurnAt: number
  /** スレッド終了時に生成される短い要約。Episodicメモリ化される素材。 */
  summary?: string
}
