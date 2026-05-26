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
  PersistNameProposalResult,
  PromptLogEntry,
  PromptLogId,
  PromptLogStore,
} from '../logs/promptLog'
import {
  defaultPromptTemplates,
  isSummaryStructured,
  type PromptTemplates,
  type SummaryStructured,
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

    // nearbyPlaceIds が未計算なら、contextBuilder が計算してくれた結果を thread に
    // 焼き付ける。次回以降の send はキャッシュ経由で同じ id 列を読む。
    // 空配列も「計算済みで該当なし」として保存する (= 再計算スキップ)。
    const computedNearby = built.breakdown.retrievedNamedPlaces.nearby
    const nearbyPlaceIds =
      thread.nearbyPlaceIds ?? computedNearby.map(p => p.id)
    const updatedThread: DialogueThread = {
      ...thread,
      lastTurnAt: characterTurn.timestamp,
      nearbyPlaceIds,
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
    runPoints?: ReadonlyArray<{ lat: number; lng: number }>,
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
    const runSummaryRendered = runSummary ? this.templates.renderRunSummary(runSummary) : ''
    // refine 判断のため、対話開始時に拾った近接既存名 (current のもの) を summarize の
    // user content に含める。description も載せて LLM が意味重複を判断しやすくする。
    const nearbyForSummary = await this.resolveNearbyForSummary(thread)
    const nearbyText = this.templates.formatNearbyPlaces(nearbyForSummary)
    const userContentParts: string[] = []
    if (facts) userContentParts.push(`[観測できた事実]\n${facts}`)
    if (runSummaryRendered) userContentParts.push(`[Run の構造 (命名候補のため)]\n${runSummaryRendered}`)
    if (nearbyText) userContentParts.push(nearbyText)
    userContentParts.push(`[今回の対話]\n${transcript}`)
    const userContent = userContentParts.join('\n\n')

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: this.templates.summaryPrompt,
      },
      { role: 'user', content: userContent },
    ]

    const promptLogId = newId()
    let summary: string
    let nameProposal: SummaryStructured['nameProposal']
    let summarizeMeta: { startedAt: number; meta: PromptLogEntry['meta'] }
    try {
      const result = await this.llm.completeStructured<SummaryStructured>(messages, {
        schema: this.templates.summaryJsonSchema,
        validate: isSummaryStructured,
      })
      summary = result.value.summary.trim()
      nameProposal = result.value.nameProposal ?? null
      summarizeMeta = { startedAt: result.meta.startedAt, meta: result.meta }
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

    // 命名は thread あたり最大1個 (per-turn 永続化は撤去済みだが念のためチェック)
    let persistResult: PersistNameProposalResult = { outcome: 'none' }
    if (nameProposal) {
      if (!runSummary) {
        persistResult = { outcome: 'skipped', reason: 'no_run_summary' }
      } else if (!runPoints || runPoints.length === 0) {
        persistResult = { outcome: 'skipped', reason: 'no_run_ref' }
      } else {
        persistResult = await this.persistNameProposalFromSummary({
          proposal: nameProposal,
          characterId: thread.characterId,
          threadId,
          runSummary,
          runPoints,
          thread,
          turns,
        })
      }
    }

    await this.promptLog.append({
      id: promptLogId,
      timestamp: summarizeMeta.startedAt,
      characterId: thread.characterId,
      threadId,
      purpose: 'summarize_thread',
      messages,
      retrieval: { fewShotCount: 0, recentTurnCount: turns.length, episodic: [], semantic: [] },
      text: summary,
      nameProposal,
      persistResult,
      meta: summarizeMeta.meta,
      templatesVersion: this.templates.version,
    })

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

  /**
   * 対話開始時に拾った近接既存名 (thread.nearbyPlaceIds) を NamedPlace[] として
   * 復元する。current でなくなった (= 既に refine された) id は除く。
   * summarize の user content と命名後の整合性チェックの両方で使う。
   */
  private async resolveNearbyForSummary(
    thread: DialogueThread,
  ): Promise<NamedPlace[]> {
    const ids = thread.nearbyPlaceIds
    if (!ids || ids.length === 0) return []
    const currentAll = await this.memory.queryNamedPlaces({
      characterId: thread.characterId,
      currentOnly: true,
    })
    const byId = new Map(currentAll.map(p => [p.id, p]))
    const out: NamedPlace[] = []
    for (const id of ids) {
      const p = byId.get(id)
      if (p) out.push(p)
    }
    return out
  }

  /**
   * closeThread の summary レスポンスに乗ってきた命名を NamedPlace として永続化。
   * - refinesPlaceId が指定されていれば refine: 新しい id の place を作り、
   *   previousId に元 id を入れる。元 place は触らない (履歴として残す)。
   *   元 id は thread.nearbyPlaceIds に入っている前提だが、安全のため
   *   実在チェック + already-refined チェックも行う。
   * - そうでなければ create: 既存と同じく新規 NamedPlace を作る。
   * スレッドあたり最大1個 (既存があれば無視) は維持。
   */
  private async persistNameProposalFromSummary(args: {
    proposal: NonNullable<SummaryStructured['nameProposal']>
    characterId: CharacterId
    threadId: ThreadId
    runSummary: RunSummary
    runPoints: ReadonlyArray<{ lat: number; lng: number }>
    thread: DialogueThread
    turns: DialogueTurn[]
  }): Promise<PersistNameProposalResult> {
    const { proposal, characterId, threadId, runSummary, runPoints, thread, turns } = args
    const name = proposal.name.trim()
    if (name === '') return { outcome: 'skipped', reason: 'empty_name' }

    const existing = await this.memory.queryNamedPlaces({
      characterId,
      sourceThreadId: threadId,
      limit: 1,
    })
    if (existing.length > 0) return { outcome: 'skipped', reason: 'existing_thread_place' }

    // run id 解決: thread.origin か turns の refs から拾う
    const runRef = thread.origin?.kind === 'run'
      ? thread.origin
      : turns.flatMap(t => t.refs ?? []).find(r => r.kind === 'run')
    if (!runRef) return { outcome: 'skipped', reason: 'no_run_ref' }

    // refine 指定があるなら、対象 place の妥当性を確認。
    let previousId: string | undefined
    const refinesId = proposal.refinesPlaceId?.trim()
    if (refinesId) {
      const allPlaces = await this.memory.queryNamedPlaces({ characterId })
      const target = allPlaces.find(p => p.id === refinesId)
      // 対象が存在しない or 既に他 place の previousId に載っている (= current でない)
      // 場合は refine を諦めて create に倒す (= silently fall back)。
      const alreadyRefined = allPlaces.some(p => p.previousId === refinesId)
      if (target && !alreadyRefined) previousId = refinesId
    }

    const now = Date.now()
    const description = (proposal.description ?? '').trim()
    const base = {
      id: newId(),
      characterId,
      name,
      description,
      sourceRunId: runRef.id,
      sourceThreadId: threadId,
      createdAt: now,
      updatedAt: now,
      ...(previousId ? { previousId } : {}),
    }

    let place: NamedPlace
    if (proposal.target === 'point') {
      const idx = proposal.pointIdx
      if (idx === undefined || idx < 0 || idx >= runPoints.length) {
        return { outcome: 'skipped', reason: 'invalid_point_idx' }
      }
      const pt = runPoints[idx]
      place = { ...base, point: { lat: pt.lat, lng: pt.lng }, sourcePointIdx: idx }
    } else if (proposal.target === 'segment') {
      const segIdx = proposal.segmentIndex
      if (segIdx === undefined) return { outcome: 'skipped', reason: 'invalid_segment_index' }
      const seg = runSummary.segments[segIdx]
      if (!seg) return { outcome: 'skipped', reason: 'invalid_segment_index' }
      const start = Math.max(0, Math.min(seg.startPointIdx, runPoints.length - 1))
      const end = Math.max(0, Math.min(seg.endPointIdx, runPoints.length - 1))
      if (end < start) return { outcome: 'skipped', reason: 'invalid_segment_bounds' }
      const polyline = []
      for (let i = start; i <= end; i++) {
        polyline.push({ lat: runPoints[i].lat, lng: runPoints[i].lng })
      }
      place = { ...base, polyline, sourceSegmentIndex: segIdx }
    } else {
      return { outcome: 'skipped', reason: 'unknown_target' }
    }

    await this.memory.putNamedPlace(place)
    return previousId
      ? { outcome: 'refined', placeId: place.id, previousId }
      : { outcome: 'created', placeId: place.id }
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
