import { Capacitor } from '@capacitor/core'
import { FirebaseAuthentication } from '@capacitor-firebase/authentication'
import { FirebaseFirestore } from '@capacitor-firebase/firestore'
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { auth, db } from './client'

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
 *
 * パターンは friends.ts / runCloud.ts の getUid()+native/web 分岐に従う。
 */

export type CoRunMemberState =
  | 'invited'
  | 'ready'
  | 'running'
  | 'finished'
  | 'declined'
  | 'left'

export type CoRunStatus = 'lobby' | 'running' | 'finished' | 'cancelled'

export type CoRunMember = {
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
export const LOBBY_TTL_MS = 3 * 60 * 1000

async function getUid(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    const { user } = await FirebaseAuthentication.getCurrentUser()
    return user?.uid ?? null
  }
  await auth.authStateReady()
  return auth.currentUser?.uid ?? null
}

async function setSessionDoc(session: CoRunSession): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await FirebaseFirestore.setDocument({
      reference: `coRuns/${session.id}`,
      data: session as unknown as Record<string, unknown>,
    })
    return
  }
  await setDoc(doc(db, 'coRuns', session.id), session)
}

/** members.{uid}.xxx など dot-path だけを更新する (他メンバーの書込みを潰さない)。 */
async function updateSessionFields(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await FirebaseFirestore.updateDocument({
      reference: `coRuns/${id}`,
      data: fields,
    })
    return
  }
  await updateDoc(doc(db, 'coRuns', id), fields)
}

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
  await setSessionDoc(session)
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
  await updateSessionFields(id, fields)
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
  await updateSessionFields(id, fields)
}

/** 自分が抜ける (招待辞退含む)。host は cancelled に倒す。 */
export async function coRunLeave(id: string, isHost: boolean): Promise<void> {
  if (isHost) {
    await coRunSetStatus(id, 'cancelled')
    return
  }
  await coRunSetMemberState(id, 'left')
}

/** host のみ: セッション doc を削除する。 */
export async function coRunDeleteSession(id: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await FirebaseFirestore.deleteDocument({ reference: `coRuns/${id}` })
    return
  }
  await deleteDoc(doc(db, 'coRuns', id))
}

function isSession(value: unknown): value is CoRunSession {
  return !!value && typeof (value as CoRunSession).id === 'string'
}

/** 単一セッション doc をリアルタイム購読する。戻り値で購読解除。 */
export function subscribeSession(
  id: string,
  cb: (session: CoRunSession | null) => void,
): () => void {
  if (Capacitor.isNativePlatform()) {
    let callbackId: string | null = null
    let removed = false
    void FirebaseFirestore.addDocumentSnapshotListener(
      { reference: `coRuns/${id}` },
      (event, error) => {
        if (error) {
          console.error('coRun session listener error', error)
          return
        }
        const data = event?.snapshot.data as CoRunSession | null | undefined
        cb(isSession(data) ? data : null)
      },
    ).then(cid => {
      callbackId = cid
      if (removed) void FirebaseFirestore.removeSnapshotListener({ callbackId: cid })
    })
    return () => {
      removed = true
      if (callbackId) void FirebaseFirestore.removeSnapshotListener({ callbackId })
    }
  }
  return onSnapshot(
    doc(db, 'coRuns', id),
    snap => cb(snap.exists() ? (snap.data() as CoRunSession) : null),
    err => console.error('coRun session listener error', err),
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
  const fresh = (sessions: CoRunSession[]) =>
    sessions.filter(s => s.expiresAt > Date.now())

  if (Capacitor.isNativePlatform()) {
    let callbackId: string | null = null
    let removed = false
    void FirebaseFirestore.addCollectionSnapshotListener(
      {
        reference: 'coRuns',
        compositeFilter: {
          type: 'and',
          queryConstraints: [
            { type: 'where', fieldPath: 'memberUids', opStr: 'array-contains', value: uid },
            { type: 'where', fieldPath: 'status', opStr: '==', value: 'lobby' },
          ],
        },
      },
      (event, error) => {
        if (error) {
          console.error('coRun lobby listener error', error)
          return
        }
        const sessions = (event?.snapshots ?? [])
          .map(s => s.data as unknown as CoRunSession | null)
          .filter(isSession)
        cb(fresh(sessions))
      },
    ).then(cid => {
      callbackId = cid
      if (removed) void FirebaseFirestore.removeSnapshotListener({ callbackId: cid })
    })
    return () => {
      removed = true
      if (callbackId) void FirebaseFirestore.removeSnapshotListener({ callbackId })
    }
  }
  const q = query(
    collection(db, 'coRuns'),
    where('memberUids', 'array-contains', uid),
    where('status', '==', 'lobby'),
  )
  return onSnapshot(
    q,
    snap => {
      const sessions = snap.docs.map(d => d.data() as CoRunSession).filter(isSession)
      cb(fresh(sessions))
    },
    err => console.error('coRun lobby listener error', err),
  )
}

// ---- 派生ゲート (スナップショットから算出) -------------------------------

/** 走る意思のあるメンバー (declined/left を除く)。 */
export function activeMemberUids(session: CoRunSession): string[] {
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
