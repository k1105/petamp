/**
 * キャラ記憶 (episodic / semantic / relational / namedPlace) の Firestore 永続化。
 * thread / turn は対象外 (会話そのものはローカルに留める)。
 *
 * パス: users/{uid}/characters/{characterId}/{kind}/{id}
 *   kind = "episodic" | "semantic" | "namedPlace"
 * relational は単一ドキュメント: users/{uid}/characters/{characterId}/relational/state
 *
 * getUid() が null なら no-op。
 */
import type { CharacterId } from '../character/domain/character'
import type {
  EpisodicMemory,
  NamedPlace,
  RelationalState,
  SemanticMemory,
} from '../character/domain/memory'
import { getUid } from './auth'
import { deleteDocument, getDocument, listDocuments, setDocument } from './firestoreAdapter'
import {
  pathCharacterEpisodic,
  pathCharacterEpisodicCol,
  pathCharacterNamedPlace,
  pathCharacterNamedPlaceCol,
  pathCharacterRelational,
  pathCharacterSemantic,
  pathCharacterSemanticCol,
} from './paths'

// ── episodic ──────────────────────────────────────────────────────────

export async function cloudPutEpisodic(m: EpisodicMemory): Promise<void> {
  const uid = await getUid()
  if (!uid) return
  await setDocument(pathCharacterEpisodic(uid, m.characterId, m.id), m)
}

export async function cloudListEpisodic(
  characterId: CharacterId,
): Promise<EpisodicMemory[]> {
  const uid = await getUid()
  if (!uid) return []
  return listDocuments<EpisodicMemory>(pathCharacterEpisodicCol(uid, characterId))
}

// ── semantic ──────────────────────────────────────────────────────────

export async function cloudPutSemantic(m: SemanticMemory): Promise<void> {
  const uid = await getUid()
  if (!uid) return
  await setDocument(pathCharacterSemantic(uid, m.characterId, m.id), m)
}

export async function cloudListSemantic(
  characterId: CharacterId,
): Promise<SemanticMemory[]> {
  const uid = await getUid()
  if (!uid) return []
  return listDocuments<SemanticMemory>(pathCharacterSemanticCol(uid, characterId))
}

export async function cloudDeleteSemantic(
  characterId: CharacterId,
  id: string,
): Promise<void> {
  const uid = await getUid()
  if (!uid) return
  await deleteDocument(pathCharacterSemantic(uid, characterId, id))
}

// ── relational ────────────────────────────────────────────────────────

export async function cloudPutRelational(state: RelationalState): Promise<void> {
  const uid = await getUid()
  if (!uid) return
  await setDocument(pathCharacterRelational(uid, state.characterId), state)
}

export async function cloudGetRelational(
  characterId: CharacterId,
): Promise<RelationalState | null> {
  const uid = await getUid()
  if (!uid) return null
  return getDocument<RelationalState>(pathCharacterRelational(uid, characterId))
}

// ── namedPlace ────────────────────────────────────────────────────────

export async function cloudPutNamedPlace(p: NamedPlace): Promise<void> {
  const uid = await getUid()
  if (!uid) return
  await setDocument(pathCharacterNamedPlace(uid, p.characterId, p.id), p)
}

export async function cloudListNamedPlaces(
  characterId: CharacterId,
): Promise<NamedPlace[]> {
  const uid = await getUid()
  if (!uid) return []
  return listDocuments<NamedPlace>(pathCharacterNamedPlaceCol(uid, characterId))
}
