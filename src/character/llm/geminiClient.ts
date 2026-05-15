import { GoogleGenAI } from '@google/genai'
import { REPLY_JSON_SCHEMA } from '../prompts/replySchema'
import type {
  LLMCallMeta,
  LLMClient,
  LLMMessage,
  LLMOptions,
  LLMReply,
  LLMReplyResult,
  LLMTextResult,
} from './client'

interface GeminiContent {
  role: 'user' | 'model'
  parts: Array<{ text: string }>
}

interface SeparatedMessages {
  systemInstruction: string | undefined
  contents: GeminiContent[]
}

/** {role:system}は systemInstruction に集約、それ以外は contents に変換。 */
function separate(messages: LLMMessage[]): SeparatedMessages {
  const systemParts: string[] = []
  const contents: GeminiContent[] = []
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content)
      continue
    }
    contents.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })
  }
  return {
    systemInstruction: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    contents,
  }
}

function isLLMReply(value: unknown): value is LLMReply {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.thought !== 'string' || typeof v.say !== 'string') return false
  if (v.topic !== undefined) {
    if (typeof v.topic !== 'object' || v.topic === null) return false
    const t = v.topic as Record<string, unknown>
    if (t.kind !== 'whole' && t.kind !== 'segment') return false
  }
  return true
}

export interface GeminiClientOptions {
  apiKey: string
  /** 既定: "gemini-2.5-flash"。完了用と返答用で分けたければ別インスタンスで。 */
  model?: string
  /** replyAsCharacter で要求する JSON schema。差し替えなければ default v1。 */
  replyJsonSchema?: object
}

const DEFAULT_MODEL = 'gemini-2.5-flash'

export class GeminiClient implements LLMClient {
  private readonly ai: GoogleGenAI
  private readonly model: string
  private readonly replyJsonSchema: object

  constructor(options: GeminiClientOptions) {
    this.ai = new GoogleGenAI({ apiKey: options.apiKey })
    this.model = options.model ?? DEFAULT_MODEL
    this.replyJsonSchema = options.replyJsonSchema ?? REPLY_JSON_SCHEMA
  }

  async replyAsCharacter(
    messages: LLMMessage[],
    options?: LLMOptions,
  ): Promise<LLMReplyResult> {
    const { systemInstruction, contents } = separate(messages)
    const startedAt = Date.now()
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction,
        temperature: options?.temperature,
        maxOutputTokens: options?.maxTokens,
        responseMimeType: 'application/json',
        responseJsonSchema: this.replyJsonSchema,
      },
    })
    const finishedAt = Date.now()
    const meta = this.buildMeta(startedAt, finishedAt, response)
    const text = response.text ?? ''
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      throw new Error(`Gemini response not valid JSON: ${text.slice(0, 200)}`, { cause: e })
    }
    if (!isLLMReply(parsed)) {
      throw new Error(
        `Gemini response missing thought/say: ${JSON.stringify(parsed).slice(0, 200)}`,
      )
    }
    return { reply: parsed, meta, raw: response }
  }

  async complete(
    messages: LLMMessage[],
    options?: LLMOptions,
  ): Promise<LLMTextResult> {
    const { systemInstruction, contents } = separate(messages)
    const startedAt = Date.now()
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction,
        temperature: options?.temperature,
        maxOutputTokens: options?.maxTokens,
      },
    })
    const finishedAt = Date.now()
    return {
      text: response.text ?? '',
      meta: this.buildMeta(startedAt, finishedAt, response),
      raw: response,
    }
  }

  private buildMeta(
    startedAt: number,
    finishedAt: number,
    response: unknown,
  ): LLMCallMeta {
    const usage = extractUsage(response)
    return {
      provider: 'google',
      model: this.model,
      startedAt,
      finishedAt,
      usage,
    }
  }
}

function extractUsage(response: unknown): LLMCallMeta['usage'] {
  if (typeof response !== 'object' || response === null) return undefined
  const meta = (response as { usageMetadata?: unknown }).usageMetadata
  if (typeof meta !== 'object' || meta === null) return undefined
  const m = meta as Record<string, unknown>
  const inputTokens = typeof m.promptTokenCount === 'number' ? m.promptTokenCount : undefined
  const outputTokens =
    typeof m.candidatesTokenCount === 'number' ? m.candidatesTokenCount : undefined
  if (inputTokens === undefined && outputTokens === undefined) return undefined
  return { inputTokens, outputTokens }
}
