import { get, set, del, keys } from 'idb-keyval'
import type { Run } from '../types'
import { cloudDeleteRun, cloudSaveRunEnsured } from '../firebase/runCloud'

const PREFIX = 'run:'

/**
 * クラウド push 待ちの最新版。run.id ごとに常に最新の Run だけを保持し、
 * リトライ中にさらに新しい保存が来ても古い版でクラウドを上書きしない。
 */
const pendingCloudPush = new Map<string, Run>()

/**
 * バックグラウンドでクラウドへ push する (リトライは cloudSaveRunEnsured が担う)。
 * 呼び出し側はブロックしない。最終的に失敗した場合はログのみ
 * (ローカル保存は成立しており、次回 loadRuns の同期でも回収されない点は許容)。
 */
function pushRunToCloud(run: Run): void {
  const alreadyPushing = pendingCloudPush.has(run.id)
  pendingCloudPush.set(run.id, run)
  if (alreadyPushing) return
  void (async () => {
    for (;;) {
      const latest = pendingCloudPush.get(run.id)
      if (!latest) return
      try {
        await cloudSaveRunEnsured(latest)
      } catch (e) {
        console.warn('cloudSaveRunEnsured failed (gave up)', e)
      }
      // push 中にさらに新しい版が来ていなければ完了
      if (pendingCloudPush.get(run.id) === latest) {
        pendingCloudPush.delete(run.id)
        return
      }
    }
  })()
}

export async function saveRun(run: Run): Promise<void> {
  await set(`${PREFIX}${run.id}`, run)
  pushRunToCloud(run)
}

export async function loadRun(id: string): Promise<Run | undefined> {
  return get<Run>(`${PREFIX}${id}`)
}

export async function listRuns(): Promise<Run[]> {
  const allKeys = await keys<string>()
  const runKeys = allKeys.filter(k => typeof k === 'string' && k.startsWith(PREFIX))
  const runs = await Promise.all(runKeys.map(k => get<Run>(k)))
  return (runs.filter(Boolean) as Run[]).sort((a, b) => b.startedAt - a.startedAt)
}

export async function deleteRun(id: string): Promise<void> {
  await del(`${PREFIX}${id}`)
  pendingCloudPush.delete(id)
  try {
    await cloudDeleteRun(id)
  } catch (e) {
    console.warn('cloudDeleteRun failed', e)
  }
}

export async function putRunLocal(run: Run): Promise<void> {
  await set(`${PREFIX}${run.id}`, run)
}
