/**
 * 問題報告 (Report) の Firestore 永続化。
 *
 * パス: reports/{reportId} (トップレベル)
 *   - uid フィールドで提出者を識別
 *   - rules では create のみ許可 (本人 uid と一致した場合)
 *
 * characterCloud と同じく Capacitor / web SDK を両対応。
 */
import { Capacitor } from '@capacitor/core'
import { FirebaseAuthentication } from '@capacitor-firebase/authentication'
import { FirebaseFirestore } from '@capacitor-firebase/firestore'
import { doc, setDoc } from 'firebase/firestore'
import { auth, db } from '../firebase/client'
import type { Report } from './types'

async function getUid(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    const { user } = await FirebaseAuthentication.getCurrentUser()
    return user?.uid ?? null
  }
  await auth.authStateReady()
  return auth.currentUser?.uid ?? null
}

async function setDocument(ref: string, data: Record<string, unknown>): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await FirebaseFirestore.setDocument({ reference: ref, data })
    return
  }
  const parts = ref.split('/')
  await setDoc(doc(db, parts[0], ...parts.slice(1)), data)
}

export async function submitReport(report: Report): Promise<void> {
  const uid = await getUid()
  if (!uid) throw new Error('not signed in')
  if (uid !== report.uid) throw new Error('uid mismatch')
  await setDocument(`reports/${report.id}`, report as unknown as Record<string, unknown>)
}
