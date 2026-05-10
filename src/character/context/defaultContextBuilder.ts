import type { Character, FewShotExample } from '../domain/character'
import type { DialogueTurn, TurnRef } from '../domain/dialogue'
import type {
  EpisodicMemory,
  RelationalState,
  SemanticMemory,
} from '../domain/memory'
import type { RunSummary } from '../domain/runSummary'
import type { LLMMessage, LLMReply } from '../llm/client'
import type { MemoryStore } from '../memory/store'
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
}

const DEFAULTS = {
  recentTurnLimit: 12,
  episodicLimit: 3,
}

export class DefaultContextBuilder implements ContextBuilder {
  private readonly memory: MemoryStore
  private readonly recentTurnLimit: number
  private readonly episodicLimit: number

  constructor(memory: MemoryStore, options?: DefaultContextBuilderOptions) {
    this.memory = memory
    this.recentTurnLimit = options?.recentTurnLimit ?? DEFAULTS.recentTurnLimit
    this.episodicLimit = options?.episodicLimit ?? DEFAULTS.episodicLimit
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

    const systemPrompt = renderSystemPrompt({
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

interface SystemPromptInput {
  character: Character
  relational: RelationalState | null
  semantic: SemanticMemory[]
  episodic: EpisodicMemory[]
  currentRefs?: TurnRef[]
  runSummary?: RunSummary
  extraSystemNote?: string
}

function refKey(r: TurnRef): string {
  return `${r.kind}:${r.id}`
}

function partitionEpisodic(
  episodic: EpisodicMemory[],
  currentRefs: TurnRef[] | undefined,
): { sameContext: EpisodicMemory[]; otherContext: EpisodicMemory[] } {
  if (!currentRefs || currentRefs.length === 0) {
    return { sameContext: [], otherContext: episodic }
  }
  const currentKeys = new Set(currentRefs.map(refKey))
  const sameContext: EpisodicMemory[] = []
  const otherContext: EpisodicMemory[] = []
  for (const m of episodic) {
    const matches = m.refs.some(r => currentKeys.has(refKey(r)))
    if (matches) sameContext.push(m)
    else otherContext.push(m)
  }
  return { sameContext, otherContext }
}

function renderSystemPrompt(input: SystemPromptInput): string {
  const sections: string[] = [input.character.persona.trim()]

  if (input.relational) {
    const r = input.relational
    sections.push(
      [
        '[関係値]',
        `- 親密度: ${r.familiarity}/100`,
        `- これまでの対話: ${r.totalTurns}ターン`,
        `- 共有してきたRun数: ${r.sharedRunIds.length}`,
      ].join('\n'),
    )
  }

  if (input.semantic.length > 0) {
    const lines = input.semantic
      .slice()
      .sort((a, b) => b.confidence - a.confidence)
      .map(s => `- ${s.key}: ${s.value}`)
    sections.push(['[ユーザについて知っていること]', ...lines].join('\n'))
  }

  const { sameContext, otherContext } = partitionEpisodic(input.episodic, input.currentRefs)

  if (sameContext.length > 0) {
    const lines = sameContext.map(e => `- ${e.summary}`)
    sections.push(
      [
        '[このRunについて、前に話したこと(超重要)]',
        '★ 以下は、今ユーザと話している "まさにこのRun" についての過去の会話だ。',
        '★ 「前にも見た似た記録」「別の場所」ではなく、目の前のRunそのもの。',
        '★ 新しい観察として始めず、前の会話の延長線として自然に続けること。',
        '★ 「まえに〜って言っていたところかな」のように別のRunを指すような言い方は禁止。',
        ...lines,
      ].join('\n'),
    )
  }

  if (otherContext.length > 0) {
    const lines = otherContext.map(e => `- ${e.summary}`)
    sections.push(
      [
        '[べつのRunで前に話したこと(参考程度)]',
        '(これらは今みているのとはべつのRunで起きた会話。混同しないこと。今のRunと結びつけて言及しないこと)',
        ...lines,
      ].join('\n'),
    )
  }

  if (input.runSummary) {
    sections.push(['[今話している話題のRun]', renderRunSummary(input.runSummary)].join('\n'))
  }

  if (input.extraSystemNote) {
    sections.push(['[このターンの追加指示]', input.extraSystemNote].join('\n'))
  }

  return sections.join('\n\n')
}

function renderRunSummary(s: RunSummary): string {
  const lines = [
    s.areaName ? `- エリア: ${s.areaName}` : null,
    `- 距離: ${(s.distanceM / 1000).toFixed(2)}km`,
    `- 時間: ${Math.round(s.durationSec / 60)}分`,
    `- 標高: +${Math.round(s.elevationGainM)}m / -${Math.round(s.elevationLossM)}m`,
    s.avgPaceSecPerKm !== null
      ? `- 平均ペース: ${formatPace(s.avgPaceSecPerKm)}/km`
      : null,
    `- 時間帯: ${s.timeOfDay}`,
    `- 停止回数: ${s.stopCount}`,
    `- メモ: ${s.noteCount}件`,
    s.vsAreaAverage
      ? `- 同エリア平均比: 距離x${s.vsAreaAverage.distanceRatio.toFixed(2)} / ペースx${s.vsAreaAverage.paceRatio.toFixed(2)} / 標高x${s.vsAreaAverage.elevationRatio.toFixed(2)}`
      : null,
  ]
  return lines.filter((l): l is string => l !== null).join('\n')
}

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm - m * 60)
  return `${m}'${s.toString().padStart(2, '0')}"`
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
