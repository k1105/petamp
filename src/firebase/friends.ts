import { Capacitor } from '@capacitor/core'
import { FirebaseAuthentication } from '@capacitor-firebase/authentication'
import { FirebaseFirestore } from '@capacitor-firebase/firestore'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore'
import { auth, db } from './client'

export type FriendDoc = {
  members: [string, string]
  createdAt: number
}

/**
 * 相互フレンドの doc ID。UID を辞書順でソートし `${minUid}__${maxUid}` で正規化。
 * これにより A→B と B→A が同じ doc になり、書込み 1 回で整合性が保たれる。
 */
export function friendDocId(uidA: string, uidB: string): string {
  const [lo, hi] = uidA < uidB ? [uidA, uidB] : [uidB, uidA]
  return `${lo}__${hi}`
}

async function getUid(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    const { user } = await FirebaseAuthentication.getCurrentUser()
    return user?.uid ?? null
  }
  await auth.authStateReady()
  return auth.currentUser?.uid ?? null
}

export async function addFriend(otherUid: string): Promise<void> {
  const uid = await getUid()
  if (!uid) throw new Error('not signed in')
  if (uid === otherUid) throw new Error('cannot add self as friend')
  const id = friendDocId(uid, otherUid)
  const [lo, hi] = uid < otherUid ? [uid, otherUid] : [otherUid, uid]
  const data: FriendDoc = {
    members: [lo, hi],
    createdAt: Date.now(),
  }
  if (Capacitor.isNativePlatform()) {
    await FirebaseFirestore.setDocument({
      reference: `friends/${id}`,
      data: data as unknown as Record<string, unknown>,
    })
    return
  }
  await setDoc(doc(db, 'friends', id), data)
}

export async function removeFriend(otherUid: string): Promise<void> {
  const uid = await getUid()
  if (!uid) throw new Error('not signed in')
  const id = friendDocId(uid, otherUid)
  if (Capacitor.isNativePlatform()) {
    await FirebaseFirestore.deleteDocument({ reference: `friends/${id}` })
    return
  }
  await deleteDoc(doc(db, 'friends', id))
}

export async function isFriendWith(otherUid: string): Promise<boolean> {
  const uid = await getUid()
  if (!uid) return false
  const id = friendDocId(uid, otherUid)
  if (Capacitor.isNativePlatform()) {
    const { snapshot } = await FirebaseFirestore.getDocument({ reference: `friends/${id}` })
    return !!snapshot.data
  }
  const snap = await getDoc(doc(db, 'friends', id))
  return snap.exists()
}

export async function listMyFriends(): Promise<FriendDoc[]> {
  const uid = await getUid()
  if (!uid) return []
  if (Capacitor.isNativePlatform()) {
    const { snapshots } = await FirebaseFirestore.getCollection({
      reference: 'friends',
      compositeFilter: {
        type: 'and',
        queryConstraints: [
          { type: 'where', fieldPath: 'members', opStr: 'array-contains', value: uid },
        ],
      },
    })
    return snapshots
      .map(s => s.data as unknown as FriendDoc | null)
      .filter((f): f is FriendDoc => !!f && Array.isArray(f.members) && f.members.length === 2)
  }
  const snap = await getDocs(
    query(collection(db, 'friends'), where('members', 'array-contains', uid)),
  )
  return snap.docs.map(d => d.data() as FriendDoc)
}

/**
 * 自分のフレンド UID 一覧 (自分自身を除く相手側 UID)。
 */
export async function listMyFriendUids(): Promise<string[]> {
  const uid = await getUid()
  if (!uid) return []
  const friends = await listMyFriends()
  return friends.map(f => (f.members[0] === uid ? f.members[1] : f.members[0]))
}
