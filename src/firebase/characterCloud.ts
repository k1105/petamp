/**
 * キャラ記憶 (episodic / semantic / relational / namedPlace) の Firestore 永続化。
 * thread / turn は対象外 (会話そのものはローカルに留める)。
 *
 * パス: users/{uid}/characters/{characterId}/{kind}/{id}
 *   kind = "episodic" | "semantic" | "namedPlace"
 * relational は単一ドキュメント: users/{uid}/characters/{characterId}/relational/state
 *
 * runCloud と同じく Capacitor / web SDK を両対応。getUid() が null なら no-op。
 */
import { Capacitor } from '@capacitor/core'
import { FirebaseAuthentication } from '@capacitor-firebase/authentication'
import { FirebaseFirestore } from '@capacitor-firebase/firestore'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from 'firebase/firestore'
import type { CharacterId } from '../character/domain/character'
import type {
  EpisodicMemory,
  NamedPlace,
  RelationalState,
  SemanticMemory,
} from '../character/domain/memory'
import { auth, db } from './client'

async function getUid(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    const { user } = await FirebaseAuthentication.getCurrentUser()
    return user?.uid ?? null
  }
  await auth.authStateReady()
  return auth.currentUser?.uid ?? null
}

function basePath(uid: string, characterId: CharacterId): string {
  return `users/${uid}/characters/${characterId}`
}

async function setDocument(ref: string, data: Record<string, unknown>): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await FirebaseFirestore.setDocument({ reference: ref, data })
    return
  }
  const parts = ref.split('/')
  // doc(db, segment1, segment2, ...) を可変長で組む
  await setDoc(doc(db, parts[0], ...parts.slice(1)), data)
}

async function deleteDocument(ref: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await FirebaseFirestore.deleteDocument({ reference: ref })
    return
  }
  const parts = ref.split('/')
  await deleteDoc(doc(db, parts[0], ...parts.slice(1)))
}

async function getDocument<T>(ref: string): Promise<T | null> {
  if (Capacitor.isNativePlatform()) {
    const { snapshot } = await FirebaseFirestore.getDocument({ reference: ref })
    return (snapshot?.data ?? null) as T | null
  }
  const parts = ref.split('/')
  const snap = await getDoc(doc(db, parts[0], ...parts.slice(1)))
  return snap.exists() ? (snap.data() as T) : null
}

async function listCollection<T>(ref: string): Promise<T[]> {
  if (Capacitor.isNativePlatform()) {
    const { snapshots } = await FirebaseFirestore.getCollection({ reference: ref })
    return snapshots.map(s => s.data as unknown as T).filter((v): v is T => v != null)
  }
  const parts = ref.split('/')
  // collection() も可変長
  const snap = await getDocs(collection(db, parts[0], ...parts.slice(1)))
  return snap.docs.map(d => d.data() as T).filter((v): v is T => v != null)
}

// ── episodic ──────────────────────────────────────────────────────────

export async function cloudPutEpisodic(m: EpisodicMemory): Promise<void> {
  const uid = await getUid()
  if (!uid) return
  await setDocument(
    `${basePath(uid, m.characterId)}/episodic/${m.id}`,
    m as unknown as Record<string, unknown>,
  )
}

export async function cloudListEpisodic(
  characterId: CharacterId,
): Promise<EpisodicMemory[]> {
  const uid = await getUid()
  if (!uid) return []
  return listCollection<EpisodicMemory>(`${basePath(uid, characterId)}/episodic`)
}

// ── semantic ──────────────────────────────────────────────────────────

export async function cloudPutSemantic(m: SemanticMemory): Promise<void> {
  const uid = await getUid()
  if (!uid) return
  await setDocument(
    `${basePath(uid, m.characterId)}/semantic/${m.id}`,
    m as unknown as Record<string, unknown>,
  )
}

export async function cloudListSemantic(
  characterId: CharacterId,
): Promise<SemanticMemory[]> {
  const uid = await getUid()
  if (!uid) return []
  return listCollection<SemanticMemory>(`${basePath(uid, characterId)}/semantic`)
}

export async function cloudDeleteSemantic(
  characterId: CharacterId,
  id: string,
): Promise<void> {
  const uid = await getUid()
  if (!uid) return
  await deleteDocument(`${basePath(uid, characterId)}/semantic/${id}`)
}

// ── relational ────────────────────────────────────────────────────────

export async function cloudPutRelational(state: RelationalState): Promise<void> {
  const uid = await getUid()
  if (!uid) return
  await setDocument(
    `${basePath(uid, state.characterId)}/relational/state`,
    state as unknown as Record<string, unknown>,
  )
}

export async function cloudGetRelational(
  characterId: CharacterId,
): Promise<RelationalState | null> {
  const uid = await getUid()
  if (!uid) return null
  return getDocument<RelationalState>(`${basePath(uid, characterId)}/relational/state`)
}

// ── namedPlace ────────────────────────────────────────────────────────

export async function cloudPutNamedPlace(p: NamedPlace): Promise<void> {
  const uid = await getUid()
  if (!uid) return
  await setDocument(
    `${basePath(uid, p.characterId)}/namedPlace/${p.id}`,
    p as unknown as Record<string, unknown>,
  )
}

export async function cloudListNamedPlaces(
  characterId: CharacterId,
): Promise<NamedPlace[]> {
  const uid = await getUid()
  if (!uid) return []
  return listCollection<NamedPlace>(`${basePath(uid, characterId)}/namedPlace`)
}
