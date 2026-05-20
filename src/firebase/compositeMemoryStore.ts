/**
 * IDB (ローカル即値) と Firestore (クラウド永続化) を組み合わせる MemoryStore。
 * - thread / turn は IDB のみ (会話そのものはローカルに留める)
 * - episodic / semantic / relational / namedPlace は IDB から read、書き込みは
 *   IDB に確定したあと Firestore に best-effort で push (失敗してもUIは止めない)
 * - 起動時の sync (Firestore → IDB) は characterSync.ts が担う
 */
import { petampCharacter } from '../character/config'
import { IdbMemoryStore } from '../character/memory/idbMemoryStore'
import type {
  DialogueThread,
  DialogueTurn,
  ThreadId,
} from '../character/domain/dialogue'
import type {
  EpisodicMemory,
  NamedPlace,
  RelationalState,
  SemanticMemory,
} from '../character/domain/memory'
import type {
  EpisodicQuery,
  MemoryStore,
  NamedPlaceQuery,
  SemanticQuery,
  ThreadQuery,
} from '../character/memory/store'
import {
  cloudDeleteSemantic,
  cloudPutEpisodic,
  cloudPutNamedPlace,
  cloudPutRelational,
  cloudPutSemantic,
} from './characterCloud'

function logCloudError(op: string, err: unknown) {
  console.warn(`[characterCloud] ${op} failed (ignored)`, err)
}

export class CompositeMemoryStore implements MemoryStore {
  private readonly idb: IdbMemoryStore

  constructor() {
    this.idb = new IdbMemoryStore()
  }

  /** sync 用に内部 IDB に直接アクセスする (cloud → IDB の流し込み用)。 */
  get local(): IdbMemoryStore {
    return this.idb
  }

  // --- Threads (IDB のみ) ---
  createThread(t: DialogueThread): Promise<void> { return this.idb.createThread(t) }
  updateThread(t: DialogueThread): Promise<void> { return this.idb.updateThread(t) }
  getThread(id: ThreadId) { return this.idb.getThread(id) }
  listThreads(q: ThreadQuery) { return this.idb.listThreads(q) }

  // --- Turns (IDB のみ) ---
  appendTurn(t: DialogueTurn): Promise<void> { return this.idb.appendTurn(t) }
  listTurns(id: ThreadId, limit?: number) { return this.idb.listTurns(id, limit) }
  deleteThread(id: ThreadId): Promise<void> { return this.idb.deleteThread(id) }

  // --- Episodic (IDB read / write-through) ---
  async putEpisodic(m: EpisodicMemory): Promise<void> {
    await this.idb.putEpisodic(m)
    cloudPutEpisodic(m).catch(e => logCloudError('putEpisodic', e))
  }
  queryEpisodic(q: EpisodicQuery) { return this.idb.queryEpisodic(q) }

  // --- Semantic (IDB read / write-through) ---
  async putSemantic(m: SemanticMemory): Promise<void> {
    await this.idb.putSemantic(m)
    cloudPutSemantic(m).catch(e => logCloudError('putSemantic', e))
  }
  querySemantic(q: SemanticQuery) { return this.idb.querySemantic(q) }
  async deleteSemantic(id: string): Promise<void> {
    // 削除対象の characterId を引くため、削除前に対象を見つける。
    // キャラは現状 petamp のみ。複数キャラ化したらここを拡張する。
    const all = await this.idb.querySemantic({ characterId: petampCharacter.id })
    const target = all.find(s => s.id === id)
    await this.idb.deleteSemantic(id)
    if (target) cloudDeleteSemantic(target.characterId, id).catch(e => logCloudError('deleteSemantic', e))
  }

  // --- NamedPlace (IDB read / write-through) ---
  async putNamedPlace(p: NamedPlace): Promise<void> {
    await this.idb.putNamedPlace(p)
    cloudPutNamedPlace(p).catch(e => logCloudError('putNamedPlace', e))
  }
  queryNamedPlaces(q: NamedPlaceQuery) { return this.idb.queryNamedPlaces(q) }

  // --- Relational (IDB read / write-through) ---
  getRelational(characterId: string) { return this.idb.getRelational(characterId) }
  async putRelational(state: RelationalState): Promise<void> {
    await this.idb.putRelational(state)
    cloudPutRelational(state).catch(e => logCloudError('putRelational', e))
  }

  // --- Maintenance ---
  /** ローカル (IDB) のみ全消去。クラウド側は触らない (取り戻せる安全装置)。 */
  clearAll(): Promise<void> { return this.idb.clearAll() }
}
