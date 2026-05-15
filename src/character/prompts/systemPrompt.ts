import type { Character } from '../domain/character'
import type { TurnRef } from '../domain/dialogue'
import type {
  EpisodicMemory,
  RelationalState,
  SemanticMemory,
} from '../domain/memory'
import type { RunSummary } from '../domain/runSummary'
import { renderRunSummary } from './runSummaryTemplate'

export interface SystemPromptInput {
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

/**
 * system prompt を組み立てる default 実装 (v1)。
 * - persona
 * - 関係値 (familiarity, 共有Run数, totalTurns)
 * - 既知の semantic 事実
 * - episodic (現コンテキストに関連 / それ以外)
 * - 今話している話題のRun
 * - このターン限定の追加指示
 */
export function renderSystemPrompt(input: SystemPromptInput): string {
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
