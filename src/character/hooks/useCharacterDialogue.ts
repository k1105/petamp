import { useCallback, useEffect, useState } from 'react'
import type { CharacterId } from '../domain/character'
import type {
  DialogueTurn,
  ThreadId,
  TurnRef,
} from '../domain/dialogue'
import type { EpisodicMemory, RelationalState } from '../domain/memory'
import type { RunSummary } from '../domain/runSummary'
import type { MemoryStore } from '../memory/store'
import type { PromptLogId } from '../logs/promptLog'
import type { DialogueService } from '../service/dialogueService'

export interface UseCharacterDialogueOptions {
  characterId: CharacterId
  service: DialogueService
  /** メモリ参照用。履歴・関係値の読み込みに使う(送信パスはservice経由)。 */
  memory: MemoryStore
  /** 既存スレッドを開く。なければsend時に新規作成される。 */
  threadId?: ThreadId
  /** 送信時に毎回付与するrefとrunSummary(画面起点で固定したい場合)。 */
  defaultRunSummary?: RunSummary
  defaultRefs?: TurnRef[]
}

export interface UseCharacterDialogueReturn {
  messages: DialogueTurn[]
  threadId: ThreadId | null
  isThinking: boolean
  relationship: RelationalState | null
  error: Error | null
  send: (text: string, options?: { extraSystemNote?: string }) => Promise<void>
  rate: (promptLogId: PromptLogId, liked: boolean, note?: string) => Promise<void>
  /** スレッドを締めて要約を生成。生成された EpisodicMemory を返す。 */
  close: () => Promise<EpisodicMemory | null>
  /** 直近の応答に対応する PromptLogEntry のID。「このターンのプロンプトを見る」導線用。 */
  lastPromptLogId: PromptLogId | null
}

export function useCharacterDialogue(
  options: UseCharacterDialogueOptions,
): UseCharacterDialogueReturn {
  const { characterId, service, memory, defaultRunSummary, defaultRefs } = options

  const [messages, setMessages] = useState<DialogueTurn[]>([])
  const [threadId, setThreadId] = useState<ThreadId | null>(options.threadId ?? null)
  const [isThinking, setIsThinking] = useState(false)
  const [relationship, setRelationship] = useState<RelationalState | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [lastPromptLogId, setLastPromptLogId] = useState<PromptLogId | null>(null)

  // 各 effect は cancelled フラグだけで stale resolve を防ぐ。
  // (以前は単一の genRef を 2 つの effect で共有していたため、片方の effect が
  //  ref を進めた瞬間にもう片方の async resolve が genRef !== gen で skip され、
  //  setMessages が呼ばれなくなる不具合があった。)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const turns = threadId ? await memory.listTurns(threadId) : []
      if (cancelled) return
      setMessages(turns)
      setLastPromptLogId(null)
      setError(null)
    })()
    return () => {
      cancelled = true
    }
  }, [memory, threadId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const r = await memory.getRelational(characterId)
      if (cancelled) return
      setRelationship(r ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [memory, characterId])

  const send = useCallback(
    async (text: string, options?: { extraSystemNote?: string }) => {
      if (!text.trim()) return
      const optimisticId = `__optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const optimisticTurn: DialogueTurn = {
        id: optimisticId,
        threadId: threadId ?? '__pending',
        role: 'user',
        content: text,
        timestamp: Date.now(),
      }
      setMessages(prev => [...prev, optimisticTurn])
      setIsThinking(true)
      setError(null)
      try {
        const result = await service.send({
          characterId,
          threadId: threadId ?? undefined,
          text,
          runSummary: defaultRunSummary,
          refs: defaultRefs,
          extraSystemNote: options?.extraSystemNote,
        })
        setThreadId(result.threadId)
        setMessages(prev => {
          const without = prev.filter(m => m.id !== optimisticId)
          return [...without, result.userTurn, result.characterTurn]
        })
        setLastPromptLogId(result.promptLogId)
        const r = await memory.getRelational(characterId)
        setRelationship(r ?? null)
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)))
      } finally {
        setIsThinking(false)
      }
    },
    [service, memory, characterId, threadId, defaultRunSummary, defaultRefs],
  )

  const rate = useCallback(
    async (promptLogId: PromptLogId, liked: boolean, note?: string) => {
      await service.rateTurn(promptLogId, liked, note)
      const r = await memory.getRelational(characterId)
      setRelationship(r ?? null)
    },
    [service, memory, characterId],
  )

  const close = useCallback(async () => {
    if (!threadId) return null
    return service.closeThread(threadId, defaultRunSummary)
  }, [service, threadId, defaultRunSummary])

  return {
    messages,
    threadId,
    isThinking,
    relationship,
    error,
    send,
    rate,
    close,
    lastPromptLogId,
  }
}
