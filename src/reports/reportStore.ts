/**
 * 問題報告 (Report) の Firestore 永続化。
 *
 * パス: reports/{reportId} (トップレベル)
 *   - uid フィールドで提出者を識別
 *   - rules では create のみ許可 (本人 uid と一致した場合)
 */
import { getUid } from '../firebase/auth'
import { setDocument } from '../firebase/firestoreAdapter'
import { pathReport } from '../firebase/paths'
import type { Report } from './types'

export async function submitReport(report: Report): Promise<void> {
  const uid = await getUid()
  if (!uid) throw new Error('not signed in')
  if (uid !== report.uid) throw new Error('uid mismatch')
  await setDocument(pathReport(report.id), report)
}
