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

/**
 * ペタンプが「忘れたくない」と思って名づけた場所。座標に紐づく。
 * - 1ターンに最大1個 (会話スレッドあたり最大1個)
 * - 将来の別Runでも近くを走れば surface される
 *
 * refine (名前の付け直し) は **in-place 更新ではなく** 新しい NamedPlace を作って
 * `previousId` で旧版を指す。旧版は削除せずに残し、履歴を辿れるようにする。
 * 「現在 (current)」は ある place の id が他の place の `previousId` に
 * 載っていない、chain の末端を指す。
 */
export interface NamedPlace {
  id: string
  characterId: CharacterId
  /** ペタンプがつけた名前。 */
  name: string
  /**
   * 命名 / refine 時の意図 (1-2文、ペタンプ口調)。なぜそう名づけたのか。
   * 過去のデータには無いので、消費側は `?? ''` でフォールバックすること。
   */
  description: string
  /** 1点に紐づける場合の lat/lng。 */
  point?: { lat: number; lng: number }
  /** 区間に紐づける場合の経路 (lat/lng の連なり)。 */
  polyline?: Array<{ lat: number; lng: number }>
  /** 命名の元になった Run。 */
  sourceRunId: string
  /** point 命名のときの accepted pts index。 */
  sourcePointIdx?: number
  /** segment 命名のときの segment index。 */
  sourceSegmentIndex?: number
  /** どの会話スレッドで生まれた名前か。 */
  sourceThreadId: ThreadId
  createdAt: number
  /** in-place 更新の余地用 (将来用)。新規/refine では createdAt と同値。 */
  updatedAt: number
  /** refine 時に、置き換える元の place の id を入れる。chain で履歴を辿るのに使う。 */
  previousId?: string
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
