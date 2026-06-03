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
import { auth, db } from './client'
import type { Run } from '../types'

function stripForCloud(run: Run): Run {
  return {
    ...run,
    notes: run.notes.map(n => {
      const copy = { ...n }
      delete copy.photoDataUrl
      return copy
    }),
  }
}

async function getUid(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    const { user } = await FirebaseAuthentication.getCurrentUser()
    return user?.uid ?? null
  }
  await auth.authStateReady()
  return auth.currentUser?.uid ?? null
}

export async function cloudSaveRun(run: Run): Promise<void> {
  const uid = await getUid()
  if (!uid) return
  const sanitized = stripForCloud(run)
  if (Capacitor.isNativePlatform()) {
    await FirebaseFirestore.setDocument({
      reference: `users/${uid}/runs/${run.id}`,
      data: sanitized as unknown as Record<string, unknown>,
    })
    return
  }
  await setDoc(doc(db, 'users', uid, 'runs', run.id), sanitized)
}

export async function cloudDeleteRun(runId: string): Promise<void> {
  const uid = await getUid()
  if (!uid) return
  if (Capacitor.isNativePlatform()) {
    await FirebaseFirestore.deleteDocument({
      reference: `users/${uid}/runs/${runId}`,
    })
    return
  }
  await deleteDoc(doc(db, 'users', uid, 'runs', runId))
}

export async function cloudListRuns(): Promise<Run[]> {
  const uid = await getUid()
  if (!uid) return []
  return cloudListRunsOf(uid)
}

export async function cloudListRunsOf(uid: string): Promise<Run[]> {
  if (Capacitor.isNativePlatform()) {
    const { snapshots } = await FirebaseFirestore.getCollection({
      reference: `users/${uid}/runs`,
    })
    return snapshots
      .map(s => s.data as unknown as Run | null)
      .filter((r): r is Run => !!r && typeof r.id === 'string')
  }
  const snap = await getDocs(collection(db, 'users', uid, 'runs'))
  return snap.docs.map(d => d.data() as Run).filter(r => !!r && typeof r.id === 'string')
}

/** 指定ユーザーの単一ランを取得する (一緒に走るモードの合成再生で他参加者の軌跡を読む)。 */
export async function cloudGetRunOf(uid: string, runId: string): Promise<Run | null> {
  if (Capacitor.isNativePlatform()) {
    const { snapshot } = await FirebaseFirestore.getDocument({
      reference: `users/${uid}/runs/${runId}`,
    })
    const data = snapshot.data as Run | null | undefined
    return data && typeof data.id === 'string' ? data : null
  }
  const snap = await getDoc(doc(db, 'users', uid, 'runs', runId))
  return snap.exists() ? (snap.data() as Run) : null
}
