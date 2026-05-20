import type { CharacterId } from '../domain/character'
import type { DialogueThread, DialogueTurn, ThreadId, TurnRef } from '../domain/dialogue'
import type {
  EpisodicMemory,
  NamedPlace,
  RelationalState,
  SemanticMemory,
} from '../domain/memory'

export interface ThreadQuery {
  characterId: CharacterId
  limit?: number
}

export interface EpisodicQuery {
  characterId: CharacterId
  /** これらのrefを含むエピソードを優先して返す。 */
  relatedTo?: TurnRef[]
  limit?: number
}

export interface SemanticQuery {
  characterId: CharacterId
  /** key prefixで絞り込み(例: "preference.")。 */
  keyPrefix?: string
}

export interface NamedPlaceQuery {
  characterId: CharacterId
  /** 中心座標と半径 (m) で近傍検索。指定なしは全件返す。 */
  near?: { lat: number; lng: number; radiusM: number }
  /** 特定 thread で生まれた名前のみ返す。 */
  sourceThreadId?: ThreadId
  limit?: number
}

/** キャラ単位の永続化。実装は IndexedDB / LocalStorage どちらでもよい。 */
export interface MemoryStore {
  // --- Threads & Turns ---
  createThread(thread: DialogueThread): Promise<void>
  updateThread(thread: DialogueThread): Promise<void>
  getThread(id: ThreadId): Promise<DialogueThread | undefined>
  listThreads(query: ThreadQuery): Promise<DialogueThread[]>

  appendTurn(turn: DialogueTurn): Promise<void>
  /** スレッド内のターンを古い→新しい順で。limitで末尾N件に絞る。 */
  listTurns(threadId: ThreadId, limit?: number): Promise<DialogueTurn[]>
  /** スレッド本体と紐づくturnsをまとめて削除。 */
  deleteThread(id: ThreadId): Promise<void>

  // --- Episodic ---
  putEpisodic(memory: EpisodicMemory): Promise<void>
  queryEpisodic(query: EpisodicQuery): Promise<EpisodicMemory[]>

  // --- Semantic ---
  putSemantic(memory: SemanticMemory): Promise<void>
  querySemantic(query: SemanticQuery): Promise<SemanticMemory[]>
  deleteSemantic(id: string): Promise<void>

  // --- NamedPlace ---
  putNamedPlace(place: NamedPlace): Promise<void>
  queryNamedPlaces(query: NamedPlaceQuery): Promise<NamedPlace[]>

  // --- Relational ---
  getRelational(characterId: CharacterId): Promise<RelationalState | undefined>
  putRelational(state: RelationalState): Promise<void>

  /** すべてのキャラクター記憶 (threads/turns/episodic/semantic/relational) を消去。 */
  clearAll(): Promise<void>
}
