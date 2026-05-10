import { del, get, keys, set } from 'idb-keyval'
import type { CharacterId } from '../domain/character'
import type {
  DialogueThread,
  DialogueTurn,
  ThreadId,
  TurnRef,
} from '../domain/dialogue'
import type {
  EpisodicMemory,
  RelationalState,
  SemanticMemory,
} from '../domain/memory'
import type {
  EpisodicQuery,
  MemoryStore,
  SemanticQuery,
  ThreadQuery,
} from './store'

const PFX = {
  thread: 'char:thread:',
  turn: 'char:turn:',
  episodic: 'char:episodic:',
  semantic: 'char:semantic:',
  relational: 'char:relational:',
}

/** 13桁ゼロ埋め timestamp。lexicographic順 = 時系列順を保証。 */
function padTs(ts: number): string {
  return ts.toString().padStart(13, '0')
}

function threadKey(id: ThreadId): string {
  return `${PFX.thread}${id}`
}

function turnKey(turn: DialogueTurn): string {
  return `${PFX.turn}${turn.threadId}:${padTs(turn.timestamp)}:${turn.id}`
}

function turnPrefix(threadId: ThreadId): string {
  return `${PFX.turn}${threadId}:`
}

function episodicKey(memory: EpisodicMemory): string {
  return `${PFX.episodic}${memory.characterId}:${memory.id}`
}

function episodicPrefix(characterId: CharacterId): string {
  return `${PFX.episodic}${characterId}:`
}

function semanticKey(memory: SemanticMemory): string {
  return `${PFX.semantic}${memory.characterId}:${memory.id}`
}

function semanticPrefix(characterId: CharacterId): string {
  return `${PFX.semantic}${characterId}:`
}

function relationalKey(characterId: CharacterId): string {
  return `${PFX.relational}${characterId}`
}

async function keysWithPrefix(prefix: string): Promise<string[]> {
  const all = await keys<string>()
  return all.filter(
    (k): k is string => typeof k === 'string' && k.startsWith(prefix),
  )
}

async function loadByPrefix<T>(prefix: string): Promise<T[]> {
  const matched = await keysWithPrefix(prefix)
  const values = await Promise.all(matched.map(k => get<T>(k)))
  const result: T[] = []
  for (const v of values) if (v !== undefined) result.push(v)
  return result
}

function refKey(ref: TurnRef): string {
  return `${ref.kind}:${ref.id}`
}

/** refの重なり数。多いほど関連性が高い。 */
function refOverlap(a: TurnRef[], b: TurnRef[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const set = new Set(a.map(refKey))
  let count = 0
  for (const ref of b) if (set.has(refKey(ref))) count++
  return count
}

export class IdbMemoryStore implements MemoryStore {
  // --- Threads ---

  async createThread(thread: DialogueThread): Promise<void> {
    await set(threadKey(thread.id), thread)
  }

  async updateThread(thread: DialogueThread): Promise<void> {
    await set(threadKey(thread.id), thread)
  }

  async getThread(id: ThreadId): Promise<DialogueThread | undefined> {
    return get<DialogueThread>(threadKey(id))
  }

  async listThreads(query: ThreadQuery): Promise<DialogueThread[]> {
    const all = await loadByPrefix<DialogueThread>(PFX.thread)
    const filtered = all
      .filter(t => t.characterId === query.characterId)
      .sort((a, b) => b.lastTurnAt - a.lastTurnAt)
    return query.limit !== undefined ? filtered.slice(0, query.limit) : filtered
  }

  // --- Turns ---

  async appendTurn(turn: DialogueTurn): Promise<void> {
    await set(turnKey(turn), turn)
  }

  async listTurns(threadId: ThreadId, limit?: number): Promise<DialogueTurn[]> {
    const matched = await keysWithPrefix(turnPrefix(threadId))
    matched.sort()
    const sliced = limit !== undefined ? matched.slice(-limit) : matched
    const turns = await Promise.all(sliced.map(k => get<DialogueTurn>(k)))
    return turns.filter((t): t is DialogueTurn => t !== undefined)
  }

  async deleteThread(id: ThreadId): Promise<void> {
    const turnKeys = await keysWithPrefix(turnPrefix(id))
    await Promise.all(turnKeys.map(k => del(k)))
    await del(threadKey(id))
  }

  // --- Episodic ---

  async putEpisodic(memory: EpisodicMemory): Promise<void> {
    await set(episodicKey(memory), memory)
  }

  async queryEpisodic(query: EpisodicQuery): Promise<EpisodicMemory[]> {
    const all = await loadByPrefix<EpisodicMemory>(
      episodicPrefix(query.characterId),
    )
    if (query.relatedTo && query.relatedTo.length > 0) {
      const scored = all
        .map(m => ({ m, score: refOverlap(query.relatedTo!, m.refs) }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score || b.m.createdAt - a.m.createdAt)
        .map(s => s.m)
      return query.limit !== undefined ? scored.slice(0, query.limit) : scored
    }
    const sorted = all.sort((a, b) => b.createdAt - a.createdAt)
    return query.limit !== undefined ? sorted.slice(0, query.limit) : sorted
  }

  // --- Semantic ---

  async putSemantic(memory: SemanticMemory): Promise<void> {
    await set(semanticKey(memory), memory)
  }

  async querySemantic(query: SemanticQuery): Promise<SemanticMemory[]> {
    const all = await loadByPrefix<SemanticMemory>(
      semanticPrefix(query.characterId),
    )
    if (query.keyPrefix) {
      return all.filter(m => m.key.startsWith(query.keyPrefix!))
    }
    return all
  }

  async deleteSemantic(id: string): Promise<void> {
    // characterId未指定でもいいよう全prefix探索
    const matched = await keysWithPrefix(PFX.semantic)
    for (const k of matched) {
      if (k.endsWith(`:${id}`)) {
        await del(k)
        return
      }
    }
  }

  // --- Relational ---

  async getRelational(
    characterId: CharacterId,
  ): Promise<RelationalState | undefined> {
    return get<RelationalState>(relationalKey(characterId))
  }

  async putRelational(state: RelationalState): Promise<void> {
    await set(relationalKey(state.characterId), state)
  }

  async clearAll(): Promise<void> {
    const allKeys = await keys<string>()
    const targets = allKeys.filter(
      (k): k is string =>
        typeof k === 'string' &&
        (k.startsWith(PFX.thread) ||
          k.startsWith(PFX.turn) ||
          k.startsWith(PFX.episodic) ||
          k.startsWith(PFX.semantic) ||
          k.startsWith(PFX.relational)),
    )
    await Promise.all(targets.map(k => del(k)))
  }
}
