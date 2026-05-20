/**
 * キャラ記憶のクラウド <-> ローカル同期。
 *
 * sync ポリシー (シンプル / MVP):
 * - ログイン直後に1回、Firestore → IDB に pull する (上書き)
 *   ・サインアウト中の Composite はローカルだけで完結しているので、サインインで合流する形
 * - 初回マイグレーション (キーが IDB にない場合) に限り、IDB → Firestore に push して
 *   既存のローカル記憶をクラウドに移行する
 * - 通常運用は CompositeMemoryStore の write-through で同期される
 */
import { get, set } from 'idb-keyval'
import type { CharacterId } from '../character/domain/character'
import {
  cloudListEpisodic,
  cloudListNamedPlaces,
  cloudListSemantic,
  cloudGetRelational,
  cloudPutEpisodic,
  cloudPutNamedPlace,
  cloudPutRelational,
  cloudPutSemantic,
} from './characterCloud'
import type { CompositeMemoryStore } from './compositeMemoryStore'

function migrationFlagKey(characterId: CharacterId): string {
  return `char:cloudMigration:${characterId}`
}

/**
 * ログイン後に呼ぶ。
 * 1. Firestore → IDB に pull
 * 2. 初回マイグレーション未完なら IDB → Firestore を push
 *
 * 失敗してもアプリ動作を止めないよう、各ステップ単位で例外を握りつぶす。
 */
export async function syncCharacterMemoryOnAuth(
  memory: CompositeMemoryStore,
  characterId: CharacterId,
): Promise<void> {
  try {
    await pullDownFromCloud(memory, characterId)
  } catch (e) {
    console.warn('[characterSync] pull failed', e)
  }
  try {
    await migrateUpIfNeeded(memory, characterId)
  } catch (e) {
    console.warn('[characterSync] migrate failed', e)
  }
}

async function pullDownFromCloud(
  memory: CompositeMemoryStore,
  characterId: CharacterId,
): Promise<void> {
  const [episodic, semantic, relational, namedPlaces] = await Promise.all([
    cloudListEpisodic(characterId),
    cloudListSemantic(characterId),
    cloudGetRelational(characterId),
    cloudListNamedPlaces(characterId),
  ])
  // 内部 IDB に直接 write (cloud に再 push されないようにバイパス)
  const idb = memory.local
  await Promise.all([
    ...episodic.map(m => idb.putEpisodic(m)),
    ...semantic.map(m => idb.putSemantic(m)),
    ...namedPlaces.map(p => idb.putNamedPlace(p)),
    relational ? idb.putRelational(relational) : Promise.resolve(),
  ])
}

async function migrateUpIfNeeded(
  memory: CompositeMemoryStore,
  characterId: CharacterId,
): Promise<void> {
  const flagKey = migrationFlagKey(characterId)
  const done = await get<boolean>(flagKey)
  if (done) return

  const idb = memory.local
  const [episodic, semantic, namedPlaces, relational] = await Promise.all([
    idb.queryEpisodic({ characterId }),
    idb.querySemantic({ characterId }),
    idb.queryNamedPlaces({ characterId }),
    idb.getRelational(characterId),
  ])

  await Promise.all([
    ...episodic.map(m => cloudPutEpisodic(m)),
    ...semantic.map(m => cloudPutSemantic(m)),
    ...namedPlaces.map(p => cloudPutNamedPlace(p)),
    relational ? cloudPutRelational(relational) : Promise.resolve(),
  ])

  await set(flagKey, true)
}
