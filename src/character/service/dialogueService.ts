import type { CharacterId } from '../domain/character'
import type { DialogueTurn, ThreadId, TurnRef } from '../domain/dialogue'
import type { EpisodicMemory, RelationalState } from '../domain/memory'
import type { RunSummary } from '../domain/runSummary'
import type { LLMReply } from '../llm/client'
import type { PromptLogId } from '../logs/promptLog'

export interface SendInput {
  characterId: CharacterId
  /** 既存スレッドに継ぐ場合に指定。なければ新規スレッドを作る。 */
  threadId?: ThreadId
  text: string
  /** 話題のRun(RunDetailから話しかけた等)。 */
  runSummary?: RunSummary
  /**
   * 話題Runの軌跡点列 (acceptedPoints と同じ順序)。
   * nameProposal の座標解決に使う。なければ命名は永続化されない。
   */
  runPoints?: ReadonlyArray<{ lat: number; lng: number }>
  refs?: TurnRef[]
  /** このターンだけsystem promptに足したい指示 (締めの指示など)。 */
  extraSystemNote?: string
}

export interface DialogueResult {
  threadId: ThreadId
  /** ユーザターン + キャラターン。両方が永続化済み。 */
  userTurn: DialogueTurn
  characterTurn: DialogueTurn
  /** thought含む生返答。UIは characterTurn.content (= say) を出す想定。 */
  reply: LLMReply
  /** 対応する PromptLogEntry のID。UIから「このターンのプロンプトを見る」導線が引ける。 */
  promptLogId: PromptLogId
}

/**
 * UI(useCharacterDialogue)から呼ばれる単一の窓口。
 * 内部で ContextBuilder → LLMClient → MemoryStore更新 → PromptLog書き込み を行う。
 * 副作用の発生順序はこの層に閉じる。
 */
export interface DialogueService {
  send(input: SendInput): Promise<DialogueResult>
  /**
   * スレッドを終了して要約→Episodic化を走らせる。
   * 生成された EpisodicMemory を返す(turn が0件 / LLM失敗時は null)。
   * runSummary と runPoints を渡すと、観測事実をもとにより具体的な日記になり、
   * かつ命名 (nameProposal) があれば NamedPlace として永続化される。
   */
  closeThread(
    threadId: ThreadId,
    runSummary?: RunSummary,
    runPoints?: ReadonlyArray<{ lat: number; lng: number }>,
  ): Promise<EpisodicMemory | null>
  /**
   * スレッドを破棄。turns/promptLog/threadを削除し、関係値を session 開始時の
   * snapshot に巻き戻す。snapshot が null の場合は freshRelational に戻す。
   */
  discardThread(
    threadId: ThreadId,
    relationalRestoreTo: RelationalState | null,
  ): Promise<void>
  /** 評価フィードバック。PromptLogStore.rate を叩いて関係値も微調整する想定。 */
  rateTurn(promptLogId: PromptLogId, liked: boolean, note?: string): Promise<void>
}
