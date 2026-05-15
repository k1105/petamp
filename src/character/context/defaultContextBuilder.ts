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
    const [relational, semantic, episodic, recentTurns] = await Promise.all([
      this.memory.getRelational(characterId),
      this.memory.querySemantic({ characterId }),
      this.memory.queryEpisodic({
        characterId,
        relatedTo: input.refs,
        limit: this.episodicLimit,
      }),
      this.memory.listTurns(input.thread.id, this.recentTurnLimit),
    ])

    const systemPrompt = this.templates.renderSystemPrompt({
      character: input.character,
      relational: relational ?? null,
      semantic,
      episodic,
      currentRefs: input.refs,
      runSummary: input.runSummary,
      extraSystemNote: input.extraSystemNote,
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
        runSummary: input.runSummary,
      },
    }
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
