import type { CharacterId } from './character'
import type { LLMReplyTopic } from '../llm/client'

export type ThreadId = string
export type TurnId = string

type TurnRole = 'user' | 'character'

export interface DialogueTurn {
  id: TurnId
  threadId: ThreadId
  role: TurnRole
  /** ユーザ入力 / キャラの最終発話(say)。thoughtはここには含めない(ログ側に残す)。 */
  content: string
  timestamp: number
  /** このターンが言及している外部オブジェクトへの参照。 */
  refs?: TurnRef[]
  /** キャラ発話のとき、軌跡上のどこを指しているか。可視化レイヤが使う。 */
  topic?: LLMReplyTopic
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
  /**
   * このスレッドの Run 軌跡近く (default 50m) に既にある NamedPlace の id 一覧。
   * 最初の send で計算してキャッシュし、以降のターンは再利用する。
   * 命名の重複や refine 判断のために LLM に毎ターン渡される。
   */
  nearbyPlaceIds?: string[]
}
