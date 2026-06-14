import type { Run } from '../types'
import { apiUrl } from '../config/appUrl'
import { getIdToken } from './auth'

/** api/notify-run 側の MAX_RUN_AGE_MS と同じ基準。古いランは呼び出し自体を省く。 */
const MAX_RUN_AGE_MS = 6 * 60 * 60 * 1000

/**
 * フレンドへ「新しい軌跡を記録した」プッシュ通知を依頼する (fire-and-forget)。
 * 重複送信はサーバー側 (users/{uid}/runNotifications) で排他されるため、
 * 同じ runId で何度呼んでも通知は 1 回しか飛ばない。
 */
export async function notifyFriendsOfNewRun(run: Run): Promise<void> {
  if (Date.now() - run.finishedAt > MAX_RUN_AGE_MS) return
  const idToken = await getIdToken()
  if (!idToken) return
  const res = await fetch(apiUrl('notify-run'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ runId: run.id }),
  })
  if (!res.ok) throw new Error(`notify-run failed: ${res.status}`)
}
