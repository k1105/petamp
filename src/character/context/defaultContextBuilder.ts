import type { FewShotExample } from '../domain/character'
import type { DialogueTurn } from '../domain/dialogue'
import type { LLMMessage, LLMReply } from '../llm/client'
import type { MemoryStore } from '../memory/store'
import {
  defaultPromptTemplates,
  type PromptTemplates,
} from '../prompts'
import type {
  BuildContextInput,
  BuiltContext,
  ContextBuilder,
} from './builder'

export interface DefaultContextBuilderOptions {
  /** 履歴に含める直近ターン数。 */
  recentTurnLimit?: number
  /** 引いてくるエピソード上限。 */
  episodicLimit?: number
  /** プロンプト整形テンプレ。default は defaultPromptTemplates (v1)。 */
  templates?: PromptTemplates
}

const DEFAULTS = {
  recentTurnLimit: 12,
  episodicLimit: 3,
}

export class DefaultContextBuilder implements ContextBuilder {
  private readonly memory: MemoryStore
  private readonly recentTurnLimit: number
  private readonly episodicLimit: number
  private readonly templates: PromptTemplates

  constructor(memory: MemoryStore, options?: DefaultContextBuilderOptions) {
    this.memory = memory
    this.recentTurnLimit = options?.recentTurnLimit ?? DEFAULTS.recentTurnLimit
    this.episodicLimit = options?.episodicLimit ?? DEFAULTS.episodicLimit
    this.templates = options?.templates ?? defaultPromptTemplates
  }

  /** 注入されたテンプレートのバージョン。ログ記録用。 */
  get templatesVersion(): string {
    return this.templates.version
  }

  async build(input: BuildContextInput): Promise<BuiltContext> {
    const characterId = input.character.id
    const [relational, semantic, episodic, recentTurns, currentThreadNames] = await Promise.all([
      this.memory.getRelational(characterId),
      this.memory.querySemantic({ characterId }),
      this.memory.queryEpisodic({
        characterId,
        relatedTo: input.refs,
        limit: this.episodicLimit,
      }),
      this.memory.listTurns(input.thread.id, this.recentTurnLimit),
      this.memory.queryNamedPlaces({
        characterId,
        sourceThreadId: input.thread.id,
      }),
    ])

    const nearbyNames = await this.queryNearbyNames(characterId, input)

    const systemPrompt = this.templates.renderSystemPrompt({
      character: input.character,
      relational: relational ?? null,
      semantic,
      episodic,
      currentRefs: input.refs,
      runSummary: input.runSummary,
      extraSystemNote: input.extraSystemNote,
      currentThreadNames,
      nearbyNames,
    })

    const messages: LLMMessage[] = [{ role: 'system', content: systemPrompt }]
    for (const ex of input.character.fewShot) messages.push(...renderFewShot(ex))
    for (const t of recentTurns) messages.push(renderTurn(t))
    messages.push({ role: 'user', content: input.userInput })

    return {
      messages,
      breakdown: {
        systemPrompt,
        fewShotCount: input.character.fewShot.length,
        recentTurnCount: recentTurns.length,
        relational: relational ?? null,
        retrievedEpisodic: episodic,
        retrievedSemantic: semantic,
        retrievedNamedPlaces: {
          currentThread: currentThreadNames,
          nearby: nearbyNames,
        },
        runSummary: input.runSummary,
      },
    }
  }

  private async queryNearbyNames(
    characterId: string,
    input: BuildContextInput,
  ) {
    const pts = input.runPoints
    if (!pts || pts.length === 0) return []
    // 今のRunの bbox の中央から一定半径を見る。bbox 対角線の半分 + 100m を半径に。
    let latMin = Infinity, latMax = -Infinity, lngMin = Infinity, lngMax = -Infinity
    for (const p of pts) {
      if (p.lat < latMin) latMin = p.lat
      if (p.lat > latMax) latMax = p.lat
      if (p.lng < lngMin) lngMin = p.lng
      if (p.lng > lngMax) lngMax = p.lng
    }
    const center = { lat: (latMin + latMax) / 2, lng: (lngMin + lngMax) / 2 }
    // 1度 ≈ 111km。雑に対角線半分を m 換算。
    const R = 6371000
    const dLat = ((latMax - latMin) * Math.PI) / 180
    const dLng = ((lngMax - lngMin) * Math.PI) / 180 * Math.cos((center.lat * Math.PI) / 180)
    const diagM = Math.sqrt(dLat * dLat + dLng * dLng) * R
    const radiusM = diagM / 2 + 100
    const all = await this.memory.queryNamedPlaces({
      characterId,
      near: { lat: center.lat, lng: center.lng, radiusM },
      limit: 8,
    })
    // 現スレッドで生まれた名前は別セクションで出すので除外。
    return all.filter(p => p.sourceThreadId !== input.thread.id)
  }
}

/** few-shot1組をuser/assistant 2メッセージに展開。assistantはJSON文字列。 */
function renderFewShot(example: FewShotExample): LLMMessage[] {
  return [
    { role: 'user', content: example.user },
    { role: 'assistant', content: serializeReply(example.assistant) },
  ]
}

function renderTurn(turn: DialogueTurn): LLMMessage {
  if (turn.role === 'user') {
    return { role: 'user', content: turn.content }
  }
  // 履歴ターンには thought を保持していないので空文字で埋める。
  return {
    role: 'assistant',
    content: serializeReply({ thought: '', say: turn.content }),
  }
}

function serializeReply(reply: LLMReply): string {
  return JSON.stringify(reply)
}
