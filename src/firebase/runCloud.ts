import { Capacitor } from '@capacitor/core'
import { FirebaseAuthentication } from '@capacitor-firebase/authentication'
import { FirebaseFirestore } from '@capacitor-firebase/firestore'
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
} from 'firebase/firestore'
import { auth, db } from './client'
import type { Run } from '../types'

function stripForCloud(run: Run): Run {
  return {
    ...run,
    notes: run.notes.map(({ photoDataUrl: _omit, ...rest }) => rest),
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
  if (Capacitor.isNativePlatform()) {
    const { snapshots } = await FirebaseFirestore.getCollection({
      reference: `users/${uid}/runs`,
    })
    return snapshots.map(s => s.data as unknown as Run).filter(Boolean)
  }
  const snap = await getDocs(collection(db, 'users', uid, 'runs'))
  return snap.docs.map(d => d.data() as Run)
}
