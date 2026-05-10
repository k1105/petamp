import type { CharacterId } from './character'
import type { ThreadId, TurnRef } from './dialogue'

/** 過去スレッドの要約。検索の単位。 */
export interface EpisodicMemory {
  id: string
  characterId: CharacterId
  threadId: ThreadId
  summary: string
  /** 話題になったRun/Note/エリア。retrievalのキー。 */
  refs: TurnRef[]
  createdAt: number
}

/** 抽出された「事実」。key-value的に蓄積。 */
export interface SemanticMemory {
  id: string
  characterId: CharacterId
  /** 例: "preference.weather", "habit.run_day", "fact.home_area" */
  key: string
  value: string
  /** 抽出元のスレッド/ターン。あとで根拠を辿るため。 */
  sourceThreadId?: ThreadId
  /** 0-1。後続の言及で強化/弱化していく。 */
  confidence: number
  createdAt: number
  updatedAt: number
}

/** キャラとユーザの関係値。単一レコード。 */
export interface RelationalState {
  characterId: CharacterId
  /** 0-100。会話回数や継続日数で漸増。プロンプトに数値で渡して口調を制御。 */
  familiarity: number
  /** 一緒に話題にしたRun。 */
  sharedRunIds: string[]
  /** 話題タグ→出現回数。興味の重み付け。 */
  topicCounts: Record<string, number>
  totalTurns: number
  firstMetAt: number
  lastMetAt: number
}
