import type { Character } from '../domain/character'
import type { DialogueThread, TurnRef } from '../domain/dialogue'
import type { EpisodicMemory, RelationalState, SemanticMemory } from '../domain/memory'
import type { RunSummary } from '../domain/runSummary'
import type { LLMMessage } from '../llm/client'

/** 対話1ターンを組むのに必要な外部入力。UI/ストアからかき集める。 */
export interface BuildContextInput {
  character: Character
  thread: DialogueThread
  userInput: string
  /** 話題のRun(あれば)。RunDetail起点ならnon-null。 */
  runSummary?: RunSummary
  /** 話題のNoteなど。 */
  refs?: TurnRef[]
  /** このターン限定でsystem promptに添える追加指示 (締めの指示など)。 */
  extraSystemNote?: string
}

/** ContextBuilderが返す構築結果。logにそのまま入れる。 */
export interface BuiltContext {
  /** LLMClientに渡す最終メッセージ列。systemPrompt + fewShot展開 + 履歴 + userInput。 */
  messages: LLMMessage[]
  /** 構成要素の内訳。ログ・デバッグ用。 */
  breakdown: {
    systemPrompt: string
    fewShotCount: number
    recentTurnCount: number
    relational: RelationalState | null
    retrievedEpisodic: EpisodicMemory[]
    retrievedSemantic: SemanticMemory[]
    runSummary?: RunSummary
  }
}

export interface ContextBuilder {
  build(input: BuildContextInput): Promise<BuiltContext>
}
