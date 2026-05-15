import type { CharacterId } from '../domain/character'
import type { ThreadId, TurnId } from '../domain/dialogue'
import type { RunSummary } from '../domain/runSummary'
import type { LLMCallMeta, LLMMessage, LLMReply } from '../llm/client'

export type PromptLogId = string

/**
 * 1回のLLM呼び出しの完全な記録。何を渡して何が返ったか、
 * どのメモリが効いたかまで含めて後から再現できるようにする。
 */
export interface PromptLogEntry {
  id: PromptLogId
  timestamp: number
  characterId: CharacterId
  threadId: ThreadId
  /** 紐づく対話ターン。fact抽出など対話外の呼び出しではundefined。 */
  turnId?: TurnId
  /** "reply" | "extract_facts" | "summarize_thread" 等、呼び出し用途。 */
  purpose: string

  /** ユーザ入力(あれば)。 */
  userInput?: string

  /** LLMClientに最終的に渡したメッセージ列。systemPrompt含む。 */
  messages: LLMMessage[]

  /** ContextBuilderの内訳。何が引いてこられたか。 */
  retrieval: {
    fewShotCount: number
    recentTurnCount: number
    episodic: Array<{ id: string; summary: string }>
    semantic: Array<{ key: string; value: string }>
    runSummary?: RunSummary
    familiarity?: number
  }

  /** キャラ返答呼び出しのとき。 */
  reply?: LLMReply
  /** complete呼び出しのとき。 */
  text?: string

  meta: LLMCallMeta
  error?: { message: string; stack?: string }

  /** このログ生成時に使われた PromptTemplates のバージョン。差し替え時の追跡用。 */
  templatesVersion?: string

  /** あとから人手で精度評価するための欄。 */
  rating?: { liked: boolean; note?: string }
}

export interface PromptLogQuery {
  characterId?: CharacterId
  threadId?: ThreadId
  purpose?: string
  /** 期間(timestamp ms)。 */
  since?: number
  until?: number
  limit?: number
}

/**
 * プロンプトログの永続化。LocalStorageで開始、容量逼迫したらIndexedDBへ移行。
 * 実装は append-only を基本とし、評価(rating)だけ後から書き換え可能。
 */
export interface PromptLogStore {
  append(entry: PromptLogEntry): Promise<void>
  get(id: PromptLogId): Promise<PromptLogEntry | undefined>
  query(query: PromptLogQuery): Promise<PromptLogEntry[]>
  /** ratingだけ更新。entry本体は不変。 */
  rate(id: PromptLogId, rating: NonNullable<PromptLogEntry['rating']>): Promise<void>
  clear(query?: PromptLogQuery): Promise<number>
  /** 分析用に全件JSONエクスポート。 */
  exportAll(): Promise<PromptLogEntry[]>
}
