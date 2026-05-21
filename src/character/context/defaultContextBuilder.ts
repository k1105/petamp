import type { FewShotExample } from '../domain/character'
import type { DialogueTurn } from '../domain/dialogue'
import type { NamedPlace } from '../domain/memory'
import { findNearbyPlaces } from '../domain/placeProximity'
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

/** Run 軌跡からこの距離 (m) 以内にある NamedPlace を nearby として扱う。 */
const NEARBY_THRESHOLD_M = 50

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
  ): Promise<NamedPlace[]> {
    // 1. thread に既にキャッシュ (nearbyPlaceIds) があればそれを使う。
    //    chain で refine されて current でなくなった id は弾く必要があるので、
    //    currentOnly: true で全件読んでから id 一致でフィルタする。
    const cached = input.thread.nearbyPlaceIds
    if (cached !== undefined) {
      if (cached.length === 0) return []
      const currentAll = await this.memory.queryNamedPlaces({
        characterId,
        currentOnly: true,
      })
      const byId = new Map(currentAll.map(p => [p.id, p]))
      const out: NamedPlace[] = []
      for (const id of cached) {
        const p = byId.get(id)
        // current でなくなった (refine された) ものは飛ばす。
        if (p) out.push(p)
      }
      // 現スレッドで生まれた名前は別セクションで出すので除外。
      return out.filter(p => p.sourceThreadId !== input.thread.id)
    }
    // 2. キャッシュ無し: runPoints を起点に findNearbyPlaces で計算。
    //    send 側で結果を thread に書き戻すので、次回以降は (1) に乗る。
    const pts = input.runPoints
    if (!pts || pts.length === 0) return []
    const currentAll = await this.memory.queryNamedPlaces({
      characterId,
      currentOnly: true,
    })
    const nearby = findNearbyPlaces(currentAll, pts, NEARBY_THRESHOLD_M)
    return nearby.filter(p => p.sourceThreadId !== input.thread.id)
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
