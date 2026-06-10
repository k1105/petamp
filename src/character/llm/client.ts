type LLMRole = 'system' | 'user' | 'assistant'

export interface LLMMessage {
  role: LLMRole
  content: string
}

/**
 * 発話が指す話題。軌跡ハイライト等の可視化のため、
 * say が "全体について" か "特定セグメントについて" か "特定ポイントについて" を区別する。
 */
export interface LLMReplyTopic {
  kind: 'whole' | 'segment' | 'point'
  /** kind='segment' のとき: 0-based のセグメント index。 */
  segmentIndex?: number
  /** kind='point' のとき: acceptedPoints 配列の 0-based index。 */
  pointIdx?: number
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

interface LLMUsage {
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
 * 任意の JSON schema で構造化出力を取得する用の結果型。
 * value はバリデーション済みの型 T。
 */
export interface LLMStructuredResult<T> {
  value: T
  meta: LLMCallMeta
  raw?: unknown
}

export interface LLMStructuredOptions<T> extends LLMOptions {
  /** Gemini の responseJsonSchema にそのまま渡す。 */
  schema: object
  /** parsed JSON が期待型 T に一致するかチェック。失敗したら呼び出し側で投げる。 */
  validate: (v: unknown) => v is T
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
  /** 任意 schema での構造化出力。closeThread のサマライズ等で使う。 */
  completeStructured<T>(
    messages: LLMMessage[],
    options: LLMStructuredOptions<T>,
  ): Promise<LLMStructuredResult<T>>
}
