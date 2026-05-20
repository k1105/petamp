import type { Character, CharacterId } from '../domain/character'
import type {
  DialogueThread,
  DialogueTurn,
  ThreadId,
  TurnRef,
} from '../domain/dialogue'
import type { EpisodicMemory, NamedPlace, RelationalState } from '../domain/memory'
import type { RunSummary } from '../domain/runSummary'
import type { ContextBuilder } from '../context/builder'
import type { LLMClient, LLMMessage } from '../llm/client'
import type { MemoryStore } from '../memory/store'
import type {
  PromptLogEntry,
  PromptLogId,
  PromptLogStore,
} from '../logs/promptLog'
import {
  defaultPromptTemplates,
  type PromptTemplates,
} from '../prompts'
import type {
  DialogueResult,
  DialogueService,
  SendInput,
} from './dialogueService'

export interface DefaultDialogueServiceDeps {
  memory: MemoryStore
  llm: LLMClient
  contextBuilder: ContextBuilder
  promptLog: PromptLogStore
  /** Character定義の解決。CharacterIdから設定オブジェクトを返す。 */
  resolveCharacter: (id: CharacterId) => Promise<Character> | Character
  /** プロンプトテンプレ。default は defaultPromptTemplates (v1)。 */
  templates?: PromptTemplates
}

const FAMILIARITY_PER_TURN = 1
const FAMILIARITY_PER_LIKE = 2
const FAMILIARITY_PER_DISLIKE = -2

interface RetrievalBreakdown {
  fewShotCount: number
  recentTurnCount: number
  relational?: RelationalState | null
  retrievedEpisodic?: EpisodicMemory[]
  retrievedSemantic?: Array<{ key: string; value: string }>
  runSummary?: PromptLogEntry['retrieval']['runSummary']
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function newId(): string {
  return crypto.randomUUID()
}

function freshRelational(characterId: CharacterId, now: number): RelationalState {
  return {
    characterId,
    familiarity: 0,
    sharedRunIds: [],
    topicCounts: {},
    totalTurns: 0,
    firstMetAt: now,
    lastMetAt: now,
  }
}

function mergeSharedRunIds(existing: string[], refs: TurnRef[] | undefined): string[] {
  if (!refs || refs.length === 0) return existing
  const set = new Set(existing)
  for (const r of refs) if (r.kind === 'run') set.add(r.id)
  return [...set]
}

export class DefaultDialogueService implements DialogueService {
  private readonly memory: MemoryStore
  private readonly llm: LLMClient
  private readonly contextBuilder: ContextBuilder
  private readonly promptLog: PromptLogStore
  private readonly resolveCharacter: DefaultDialogueServiceDeps['resolveCharacter']
  private readonly templates: PromptTemplates

  constructor(deps: DefaultDialogueServiceDeps) {
    this.memory = deps.memory
    this.llm = deps.llm
    this.contextBuilder = deps.contextBuilder
    this.promptLog = deps.promptLog
    this.resolveCharacter = deps.resolveCharacter
    this.templates = deps.templates ?? defaultPromptTemplates
  }

  async send(input: SendInput): Promise<DialogueResult> {
    const character = await this.resolveCharacter(input.characterId)
    const now = Date.now()
    const thread = await this.resolveThread(character.id, input, now)

    const userTurn: DialogueTurn = {
      id: newId(),
      threadId: thread.id,
      role: 'user',
      content: input.text,
      timestamp: now,
      refs: input.refs,
    }
    await this.memory.appendTurn(userTurn)

    const built = await this.contextBuilder.build({
      character,
      thread,
      userInput: input.text,
      runSummary: input.runSummary,
      runPoints: input.runPoints,
      refs: input.refs,
      extraSystemNote: input.extraSystemNote,
    })

    const characterTurnId = newId()
    const promptLogId = newId()

    let result
    try {
      result = await this.llm.replyAsCharacter(built.messages)
    } catch (error) {
      await this.appendErrorLog({
        id: promptLogId,
        characterId: character.id,
        threadId: thread.id,
        turnId: characterTurnId,
        userInput: input.text,
        messages: built.messages,
        breakdown: built.breakdown,
        error,
      })
      throw error
    }

    const characterTurn: DialogueTurn = {
      id: characterTurnId,
      threadId: thread.id,
      role: 'character',
      content: result.reply.say,
      timestamp: result.meta.finishedAt,
      refs: input.refs,
      topic: result.reply.topic,
    }
    await this.memory.appendTurn(characterTurn)

    await this.persistNameProposalIfAny({
      reply: result.reply,
      characterId: character.id,
      threadId: thread.id,
      runSummary: input.runSummary,
      runPoints: input.runPoints,
      refs: input.refs,
      now: result.meta.finishedAt,
    })

    const updatedThread: DialogueThread = {
      ...thread,
      lastTurnAt: characterTurn.timestamp,
    }
    await this.memory.updateThread(updatedThread)

    await this.bumpRelational(character.id, input.refs, FAMILIARITY_PER_TURN)

    const entry: PromptLogEntry = {
      id: promptLogId,
      timestamp: result.meta.startedAt,
      characterId: character.id,
      threadId: thread.id,
      turnId: characterTurnId,
      purpose: 'reply',
      userInput: input.text,
      messages: built.messages,
      retrieval: this.buildRetrievalSnapshot(built.breakdown),
      reply: result.reply,
      meta: result.meta,
      templatesVersion: this.templates.version,
    }
    await this.promptLog.append(entry)

    return {
      threadId: thread.id,
      userTurn,
      characterTurn,
      reply: result.reply,
      promptLogId,
    }
  }

  async closeThread(
    threadId: ThreadId,
    runSummary?: RunSummary,
  ): Promise<EpisodicMemory | null> {
    const thread = await this.memory.getThread(threadId)
    if (!thread) return null
    const turns = await this.memory.listTurns(threadId)
    if (turns.length === 0) return null

    const transcript = turns
      .map(t => {
        const label = t.role === 'user' ? 'ユーザ' : 'ペタンプ'
        const body = t.content.startsWith('[internal]')
          ? t.content.slice('[internal]'.length).trim()
          : t.content
        return `${label}: ${body}`
      })
      .join('\n')
    const facts = runSummary ? this.templates.formatRunFacts(runSummary) : ''
    const userContent = facts
      ? `[観測できた事実]\n${facts}\n\n[今回の対話]\n${transcript}`
      : `[今回の対話]\n${transcript}`

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: this.templates.summaryPrompt,
      },
      { role: 'user', content: userContent },
    ]

    const promptLogId = newId()
    let summary: string
    try {
      const result = await this.llm.complete(messages)
      summary = result.text.trim()
      await this.promptLog.append({
        id: promptLogId,
        timestamp: result.meta.startedAt,
        characterId: thread.characterId,
        threadId,
        purpose: 'summarize_thread',
        messages,
        retrieval: { fewShotCount: 0, recentTurnCount: turns.length, episodic: [], semantic: [] },
        text: summary,
        meta: result.meta,
        templatesVersion: this.templates.version,
      })
    } catch (error) {
      await this.appendErrorLog({
        id: promptLogId,
        characterId: thread.characterId,
        threadId,
        purpose: 'summarize_thread',
        messages,
        breakdown: { fewShotCount: 0, recentTurnCount: turns.length },
        error,
      })
      return null
    }

    if (!summary) return null

    const refs = collectRefs(turns, thread.origin)
    const memory: EpisodicMemory = {
      id: newId(),
      characterId: thread.characterId,
      threadId,
      summary,
      refs,
      createdAt: Date.now(),
    }
    await this.memory.putEpisodic(memory)

    await this.memory.updateThread({ ...thread, summary })
    return memory
  }

  async discardThread(
    threadId: ThreadId,
    relationalRestoreTo: RelationalState | null,
  ): Promise<void> {
    const thread = await this.memory.getThread(threadId)
    if (!thread) return
    const characterId = thread.characterId
    await this.memory.deleteThread(threadId)
    await this.promptLog.clear({ threadId })
    if (relationalRestoreTo) {
      await this.memory.putRelational(relationalRestoreTo)
    } else {
      await this.memory.putRelational(freshRelational(characterId, Date.now()))
    }
  }

  async rateTurn(promptLogId: PromptLogId, liked: boolean, note?: string): Promise<void> {
    await this.promptLog.rate(promptLogId, { liked, note })
    const entry = await this.promptLog.get(promptLogId)
    if (!entry) return
    await this.bumpRelational(
      entry.characterId,
      undefined,
      liked ? FAMILIARITY_PER_LIKE : FAMILIARITY_PER_DISLIKE,
    )
  }

  // --- internals ---

  private async persistNameProposalIfAny(args: {
    reply: { topic?: { kind: string; segmentIndex?: number; pointIdx?: number }; nameProposal?: { name: string } }
    characterId: CharacterId
    threadId: ThreadId
    runSummary?: RunSummary
    runPoints?: ReadonlyArray<{ lat: number; lng: number }>
    refs?: TurnRef[]
    now: number
  }): Promise<void> {
    const { reply, characterId, threadId, runSummary, runPoints, refs, now } = args
    const proposal = reply.nameProposal
    if (!proposal) return
    const topic = reply.topic
    if (!topic || (topic.kind !== 'segment' && topic.kind !== 'point')) return
    if (!runSummary || !runPoints || runPoints.length === 0) return
    const runRef = refs?.find(r => r.kind === 'run')
    if (!runRef) return

    // スレッドあたり最大1個。既存があれば無視。
    const existing = await this.memory.queryNamedPlaces({
      characterId,
      sourceThreadId: threadId,
      limit: 1,
    })
    if (existing.length > 0) return

    const name = proposal.name.trim()
    if (name === '') return

    const base: Omit<NamedPlace, 'point' | 'polyline' | 'sourcePointIdx' | 'sourceSegmentIndex'> = {
      id: newId(),
      characterId,
      name,
      sourceRunId: runRef.id,
      sourceThreadId: threadId,
      createdAt: now,
    }

    let place: NamedPlace | null = null
    if (topic.kind === 'point') {
      const idx = topic.pointIdx
      if (idx === undefined || idx < 0 || idx >= runPoints.length) return
      const pt = runPoints[idx]
      place = { ...base, point: { lat: pt.lat, lng: pt.lng }, sourcePointIdx: idx }
    } else if (topic.kind === 'segment') {
      const segIdx = topic.segmentIndex
      if (segIdx === undefined) return
      const seg = runSummary.segments[segIdx]
      if (!seg) return
      const start = Math.max(0, Math.min(seg.startPointIdx, runPoints.length - 1))
      const end = Math.max(0, Math.min(seg.endPointIdx, runPoints.length - 1))
      if (end < start) return
      const polyline = []
      for (let i = start; i <= end; i++) {
        polyline.push({ lat: runPoints[i].lat, lng: runPoints[i].lng })
      }
      place = { ...base, polyline, sourceSegmentIndex: segIdx }
    }

    if (place) await this.memory.putNamedPlace(place)
  }

  private async resolveThread(
    characterId: CharacterId,
    input: SendInput,
    now: number,
  ): Promise<DialogueThread> {
    if (input.threadId) {
      const existing = await this.memory.getThread(input.threadId)
      if (existing) return existing
    }
    const thread: DialogueThread = {
      id: input.threadId ?? newId(),
      characterId,
      origin: input.refs?.[0],
      startedAt: now,
      lastTurnAt: now,
    }
    await this.memory.createThread(thread)
    return thread
  }

  private async bumpRelational(
    characterId: CharacterId,
    refs: TurnRef[] | undefined,
    familiarityDelta: number,
  ): Promise<void> {
    const now = Date.now()
    const current = (await this.memory.getRelational(characterId)) ?? freshRelational(characterId, now)
    const updated: RelationalState = {
      ...current,
      familiarity: clamp(current.familiarity + familiarityDelta, 0, 100),
      totalTurns: current.totalTurns + 1,
      sharedRunIds: mergeSharedRunIds(current.sharedRunIds, refs),
      lastMetAt: now,
    }
    await this.memory.putRelational(updated)
  }

  private buildRetrievalSnapshot(breakdown: RetrievalBreakdown): PromptLogEntry['retrieval'] {
    return {
      fewShotCount: breakdown.fewShotCount,
      recentTurnCount: breakdown.recentTurnCount,
      episodic: (breakdown.retrievedEpisodic ?? []).map(e => ({ id: e.id, summary: e.summary })),
      semantic: (breakdown.retrievedSemantic ?? []).map(s => ({ key: s.key, value: s.value })),
      runSummary: breakdown.runSummary,
      familiarity: breakdown.relational?.familiarity,
    }
  }

  private async appendErrorLog(args: {
    id: PromptLogId
    characterId: CharacterId
    threadId: ThreadId
    turnId?: string
    purpose?: string
    userInput?: string
    messages: LLMMessage[]
    breakdown: RetrievalBreakdown
    error: unknown
  }): Promise<void> {
    const now = Date.now()
    const errMsg = args.error instanceof Error ? args.error.message : String(args.error)
    const errStack = args.error instanceof Error ? args.error.stack : undefined
    const entry: PromptLogEntry = {
      id: args.id,
      timestamp: now,
      characterId: args.characterId,
      threadId: args.threadId,
      turnId: args.turnId,
      purpose: args.purpose ?? 'reply',
      userInput: args.userInput,
      messages: args.messages,
      retrieval: this.buildRetrievalSnapshot(args.breakdown),
      meta: {
        provider: 'unknown',
        model: 'unknown',
        startedAt: now,
        finishedAt: now,
      },
      error: { message: errMsg, stack: errStack },
      templatesVersion: this.templates.version,
    }
    await this.promptLog.append(entry)
  }
}

function collectRefs(turns: DialogueTurn[], origin: TurnRef | undefined): TurnRef[] {
  const seen = new Set<string>()
  const refs: TurnRef[] = []
  const push = (r: TurnRef) => {
    const key = `${r.kind}:${r.id}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push(r)
  }
  if (origin) push(origin)
  for (const t of turns) if (t.refs) for (const r of t.refs) push(r)
  return refs
}
