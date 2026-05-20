import { Capacitor } from '@capacitor/core'
import { FirebaseAuthentication } from '@capacitor-firebase/authentication'
import { FirebaseFirestore } from '@capacitor-firebase/firestore'
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { auth, db } from './client'

export type FollowStatus = 'pending' | 'accepted'

export type FollowDoc = {
  followerUid: string
  followeeUid: string
  status: FollowStatus
  createdAt: number
  updatedAt: number
}

export function followDocId(followerUid: string, followeeUid: string): string {
  return `${followerUid}__${followeeUid}`
}

async function getUid(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    const { user } = await FirebaseAuthentication.getCurrentUser()
    return user?.uid ?? null
  }
  await auth.authStateReady()
  return auth.currentUser?.uid ?? null
}

export async function sendFollowRequest(targetUid: string): Promise<void> {
  const uid = await getUid()
  if (!uid) throw new Error('not signed in')
  if (uid === targetUid) throw new Error('cannot follow self')
  const id = followDocId(uid, targetUid)
  const now = Date.now()
  const data: FollowDoc = {
    followerUid: uid,
    followeeUid: targetUid,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }
  if (Capacitor.isNativePlatform()) {
    await FirebaseFirestore.setDocument({
      reference: `follows/${id}`,
      data: data as unknown as Record<string, unknown>,
    })
    return
  }
  await setDoc(doc(db, 'follows', id), data)
}

export async function acceptFollowRequest(fromUid: string): Promise<void> {
  const uid = await getUid()
  if (!uid) throw new Error('not signed in')
  const id = followDocId(fromUid, uid)
  const update = { status: 'accepted' as FollowStatus, updatedAt: Date.now() }
  if (Capacitor.isNativePlatform()) {
    await FirebaseFirestore.updateDocument({
      reference: `follows/${id}`,
      data: update as unknown as Record<string, unknown>,
    })
    return
  }
  await updateDoc(doc(db, 'follows', id), update)
}

export async function rejectFollowRequest(fromUid: string): Promise<void> {
  const uid = await getUid()
  if (!uid) throw new Error('not signed in')
  await deleteFollowDoc(followDocId(fromUid, uid))
}

export async function cancelFollowRequest(targetUid: string): Promise<void> {
  const uid = await getUid()
  if (!uid) throw new Error('not signed in')
  await deleteFollowDoc(followDocId(uid, targetUid))
}

export async function unfollow(targetUid: string): Promise<void> {
  const uid = await getUid()
  if (!uid) throw new Error('not signed in')
  await deleteFollowDoc(followDocId(uid, targetUid))
}

async function deleteFollowDoc(id: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await FirebaseFirestore.deleteDocument({ reference: `follows/${id}` })
    return
  }
  await deleteDoc(doc(db, 'follows', id))
}

async function queryFollowsByField(
  field: 'followerUid' | 'followeeUid',
  uid: string,
): Promise<FollowDoc[]> {
  if (Capacitor.isNativePlatform()) {
    const { snapshots } = await FirebaseFirestore.getCollection({
      reference: 'follows',
      compositeFilter: {
        type: 'and',
        queryConstraints: [
          { type: 'where', fieldPath: field, opStr: '==', value: uid },
        ],
      },
    })
    return snapshots
      .map(s => s.data as unknown as FollowDoc | null)
      .filter((f): f is FollowDoc => !!f && typeof f.followerUid === 'string')
  }
  const snap = await getDocs(query(collection(db, 'follows'), where(field, '==', uid)))
  return snap.docs.map(d => d.data() as FollowDoc)
}

export async function listMyOutgoing(): Promise<FollowDoc[]> {
  const uid = await getUid()
  if (!uid) return []
  return queryFollowsByField('followerUid', uid)
}

export async function listMyIncoming(): Promise<FollowDoc[]> {
  const uid = await getUid()
  if (!uid) return []
  return queryFollowsByField('followeeUid', uid)
}
