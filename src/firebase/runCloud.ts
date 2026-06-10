import type { Run } from '../types'
import { getUid } from './auth'
import { deleteDocument, getDocument, listDocuments, setDocument } from './firestoreAdapter'
import { pathUserRun, pathUserRuns } from './paths'

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

async function writeRunDoc(uid: string, run: Run): Promise<void> {
  await setDocument(pathUserRun(uid, run.id), stripForCloud(run))
}

export async function cloudSaveRun(run: Run): Promise<void> {
  const uid = await getUid()
  if (!uid) return
  await writeRunDoc(uid, run)
}

/**
 * クラウド保存を「保証」する版。リトライし、最終的に失敗したら throw する。
 * 「一緒に走る」モードでは相手の端末が users/{uid}/runs/{runId} を読むので、
 * runId をセッションに公開する前にクラウドへ確実に書けたことを担保する必要がある。
 * (通常の saveRun は best-effort で失敗を握りつぶすため、ここでは別経路で保証する。)
 */
export async function cloudSaveRunEnsured(run: Run, attempts = 4): Promise<void> {
  let lastErr: unknown = null
  for (let i = 0; i < attempts; i++) {
    try {
      const uid = await getUid()
      if (!uid) throw new Error('cloudSaveRunEnsured: not signed in')
      await writeRunDoc(uid, run)
      return
    } catch (e) {
      lastErr = e
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, 500 * (i + 1)))
      }
    }
  }
  throw lastErr ?? new Error('cloudSaveRunEnsured failed')
}

export async function cloudDeleteRun(runId: string): Promise<void> {
  const uid = await getUid()
  if (!uid) return
  await deleteDocument(pathUserRun(uid, runId))
}

export async function cloudListRuns(): Promise<Run[]> {
  const uid = await getUid()
  if (!uid) return []
  return cloudListRunsOf(uid)
}

export async function cloudListRunsOf(uid: string): Promise<Run[]> {
  const runs = await listDocuments<Run>(pathUserRuns(uid))
  return runs.filter(r => typeof r.id === 'string')
}

/** 指定ユーザーの単一ランを取得する (一緒に走るモードの合成再生で他参加者の軌跡を読む)。 */
export async function cloudGetRunOf(uid: string, runId: string): Promise<Run | null> {
  const data = await getDocument<Run>(pathUserRun(uid, runId))
  return data && typeof data.id === 'string' ? data : null
}
