import { getUid } from './auth'
import {
  setDocument,
  subscribeCollection,
  subscribeDocument,
  updateDocument,
} from './firestoreAdapter'
import { pathCoRun, pathCoRuns } from './paths'

/**
 * 「一緒に走る」セッション (coRuns/{sessionId})。
 *
 * - GPS/レコードは同期しない。各自ローカルに通常どおり記録する。
 * - 同期するのは「開始」と「終了」の 2 つのゲートだけ。
 *   - 開始ゲート: host が `allReady` を検知して status='running' を書く。
 *     各クライアントは status==='running' を見て初めて録画画面へ遷移する。
 *   - 終了ゲート: 全員 finished で host が status='finished' を書く。
 * - status のフリップは host クライアントが単独所有 (write-race 回避)。
 *   非 host は自分の members[myUid] エントリだけを field-path 更新する。
 */

export type CoRunMemberState =
  | 'invited'
  | 'ready'
  | 'running'
  | 'finished'
  | 'declined'
  | 'left'

export type CoRunStatus = 'lobby' | 'running' | 'finished' | 'cancelled'

type CoRunMember = {
  displayName: string | null
  state: CoRunMemberState
  runId: string | null
  updatedAt: number
}

export type CoRunSession = {
  id: string
  hostUid: string
  memberUids: string[]
  status: CoRunStatus
  members: Record<string, CoRunMember>
  createdAt: number
  startedAt: number | null
  expiresAt: number
}

/** ロビーの有効期限。これを過ぎたセッションは陳腐とみなす。 */
const LOBBY_TTL_MS = 3 * 60 * 1000

/**
 * host がセッションを作成する。host は最初から 'ready'、他は 'invited'。
 * `members` には host を含む全参加者を渡す。
 */
export async function coRunCreateSession(
  members: { uid: string; displayName: string | null }[],
): Promise<CoRunSession> {
  const uid = await getUid()
  if (!uid) throw new Error('not signed in')
  const memberUids = members.map(m => m.uid)
  if (!memberUids.includes(uid)) throw new Error('host must be a member')
  const now = Date.now()
  const memberMap: Record<string, CoRunMember> = {}
  for (const m of members) {
    memberMap[m.uid] = {
      displayName: m.displayName,
      state: m.uid === uid ? 'ready' : 'invited',
      runId: null,
      updatedAt: now,
    }
  }
  const session: CoRunSession = {
    id: crypto.randomUUID(),
    hostUid: uid,
    memberUids,
    status: 'lobby',
    members: memberMap,
    createdAt: now,
    startedAt: null,
    expiresAt: now + LOBBY_TTL_MS,
  }
  await setDocument(pathCoRun(session.id), session)
  return session
}

/** 自分の members エントリの state (と任意で runId) を更新する。 */
export async function coRunSetMemberState(
  id: string,
  state: CoRunMemberState,
  opts?: { runId?: string },
): Promise<void> {
  const uid = await getUid()
  if (!uid) throw new Error('not signed in')
  const fields: Record<string, unknown> = {
    [`members.${uid}.state`]: state,
    [`members.${uid}.updatedAt`]: Date.now(),
  }
  if (opts?.runId !== undefined) {
    fields[`members.${uid}.runId`] = opts.runId
  }
  await updateDocument(pathCoRun(id), fields)
}

/**
 * 上位 status のフリップ。host クライアントのみが呼ぶ前提
 * (rules でも非 host の status 変更は禁止)。
 */
export async function coRunSetStatus(
  id: string,
  status: CoRunStatus,
  opts?: { startedAt?: number },
): Promise<void> {
  const fields: Record<string, unknown> = { status }
  if (opts?.startedAt !== undefined) fields.startedAt = opts.startedAt
  await updateDocument(pathCoRun(id), fields)
}

/** 自分が抜ける (招待辞退含む)。host は cancelled に倒す。 */
export async function coRunLeave(id: string, isHost: boolean): Promise<void> {
  if (isHost) {
    await coRunSetStatus(id, 'cancelled')
    return
  }
  await coRunSetMemberState(id, 'left')
}

function isSession(value: unknown): value is CoRunSession {
  return !!value && typeof (value as CoRunSession).id === 'string'
}

/** 単一セッション doc をリアルタイム購読する。戻り値で購読解除。 */
export function subscribeSession(
  id: string,
  cb: (session: CoRunSession | null) => void,
): () => void {
  return subscribeDocument<CoRunSession>(
    pathCoRun(id),
    data => cb(isSession(data) ? data : null),
    'coRun session listener',
  )
}

/**
 * 自分が招待されている lobby セッションをリアルタイム購読する。
 * `memberUids array-contains uid && status == 'lobby'`。
 * 陳腐 doc は expiresAt でクライアント側フィルタする。
 */
export function subscribeMyLobbies(
  uid: string,
  cb: (sessions: CoRunSession[]) => void,
): () => void {
  return subscribeCollection<CoRunSession>(
    pathCoRuns(),
    [
      { fieldPath: 'memberUids', opStr: 'array-contains', value: uid },
      { fieldPath: 'status', opStr: '==', value: 'lobby' },
    ],
    sessions => cb(sessions.filter(isSession).filter(s => s.expiresAt > Date.now())),
    'coRun lobby listener',
  )
}

// ---- 派生ゲート (スナップショットから算出) -------------------------------

/** 走る意思のあるメンバー (declined/left を除く)。 */
function activeMemberUids(session: CoRunSession): string[] {
  return session.memberUids.filter(uid => {
    const st = session.members[uid]?.state
    return st !== 'declined' && st !== 'left'
  })
}

/** 開始ゲート: active な全員が ready かつ ready が 2 人以上。 */
export function isAllReady(session: CoRunSession): boolean {
  const active = activeMemberUids(session)
  if (active.length < 2) return false
  return active.every(uid => session.members[uid]?.state === 'ready')
}

/** 終了ゲート: active な全員が finished。 */
export function isAllFinished(session: CoRunSession): boolean {
  const active = activeMemberUids(session)
  if (active.length === 0) return false
  return active.every(uid => session.members[uid]?.state === 'finished')
}
