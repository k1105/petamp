export type LLMRole = 'system' | 'user' | 'assistant'

export interface LLMMessage {
  role: LLMRole
  content: string
}

/**
 * 発話が指す話題。軌跡ハイライト等の可視化のため、
 * say が "全体について" か "特定セグメントについて" かを区別する。
 */
export interface LLMReplyTopic {
  kind: 'whole' | 'segment'
  /** kind='segment' のとき: 0-based のセグメント index。 */
  segmentIndex?: number
}

/**
 * Inner Thought パターン。LLMには structured output で
 * { thought, say, topic } を返させる。thoughtはユーザに表示せず、ログ・後段処理に使う。
 */
export interface LLMReply {
  /** キャラ視点の内的独白。表示はしない。 */
  thought: string
  /** 実際にユーザに見せる発話。 */
  say: string
  /**
   * 発話が指す軌跡上の場所。可視化レイヤがハイライトする。
   * 既存データとの互換性のため optional。新規生成では schema 側で必須。
   */
  topic?: LLMReplyTopic
}

export interface LLMOptions {
  /** プロバイダ非依存の温度。0-1。 */
  temperature?: number
  /** 最大出力トークン。 */
  maxTokens?: number
  /** デバッグ用タグ。ログに紐づける。 */
  tag?: string
}

export interface LLMUsage {
  inputTokens?: number
  outputTokens?: number
}

export interface LLMCallMeta {
  provider: string
  model: string
  startedAt: number
  finishedAt: number
  usage?: LLMUsage
}

export interface LLMReplyResult {
  reply: LLMReply
  meta: LLMCallMeta
  /** プロバイダ生レスポンス。デバッグ専用。 */
  raw?: unknown
}

export interface LLMTextResult {
  text: string
  meta: LLMCallMeta
  raw?: unknown
}

/**
 * プロバイダ抽象。GeminiClient / LocalLLMClient が実装する。
 * ロギングはこの層では行わない(呼び出し側のDialogueServiceが担う)。
 */
export interface LLMClient {
  /** キャラ返答用。{thought, say} の構造化出力を保証する。 */
  replyAsCharacter(messages: LLMMessage[], options?: LLMOptions): Promise<LLMReplyResult>
  /** 事実抽出・要約など、自由テキストを返す用途。 */
  complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMTextResult>
}
