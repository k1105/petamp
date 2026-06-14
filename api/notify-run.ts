/**
 * 友達への「新しいラン記録」プッシュ通知 API (Vercel Function)。
 *
 * クライアントはラン保存成功後に POST する:
 *   POST /api/notify-run
 *   Authorization: Bearer <Firebase ID トークン>
 *   body: { runId: string }
 *
 * サーバー側で friends を引いて各フレンドの FCM トークンへ送信する。
 * 重複送信は users/{uid}/runNotifications/{runId} の create 排他で防ぐ
 * (run doc 本体はクライアントの上書き保存で消えるため、別コレクションに置く)。
 *
 * 必要な環境変数:
 *   FIREBASE_SERVICE_ACCOUNT … サービスアカウント JSON 文字列
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'

/** これより古いランは通知しない (過去データの再同期で誤通知しないため) */
const MAX_RUN_AGE_MS = 6 * 60 * 60 * 1000

function initAdmin() {
  if (getApps().length === 0) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set')
    initializeApp({ credential: cert(JSON.parse(raw)) })
  }
}

function setCors(res: VercelResponse) {
  // 認可は Bearer トークンで行うため Origin は制限しない
  // (ネイティブは capacitor://localhost オリジンから呼ぶ)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  initAdmin()

  const authHeader = req.headers.authorization ?? ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!idToken) return res.status(401).json({ error: 'missing bearer token' })

  let uid: string
  try {
    uid = (await getAuth().verifyIdToken(idToken)).uid
  } catch {
    return res.status(401).json({ error: 'invalid token' })
  }

  const runId = typeof req.body?.runId === 'string' ? req.body.runId : null
  if (!runId) return res.status(400).json({ error: 'runId required' })

  const db = getFirestore()

  const runSnap = await db.doc(`users/${uid}/runs/${runId}`).get()
  if (!runSnap.exists) return res.status(404).json({ error: 'run not found' })
  const run = runSnap.data() as { finishedAt?: number }
  if (typeof run.finishedAt !== 'number' || Date.now() - run.finishedAt > MAX_RUN_AGE_MS) {
    return res.status(200).json({ skipped: 'stale' })
  }

  // 排他: 既に通知済みなら create が ALREADY_EXISTS で失敗する
  try {
    await db.doc(`users/${uid}/runNotifications/${runId}`).create({ sentAt: Date.now() })
  } catch {
    return res.status(200).json({ skipped: 'already notified' })
  }

  const friendsSnap = await db
    .collection('friends')
    .where('members', 'array-contains', uid)
    .get()
  const friendUids = friendsSnap.docs
    .flatMap(d => (d.data().members as string[]) ?? [])
    .filter(m => m !== uid)
  if (friendUids.length === 0) return res.status(200).json({ sent: 0 })

  const tokenSnaps = await Promise.all(
    friendUids.map(fuid => db.collection(`users/${fuid}/fcmTokens`).get()),
  )
  // token doc は { token, platform, updatedAt }、doc ID = トークン文字列
  const tokenRefs = tokenSnaps.flatMap(s => s.docs.map(d => ({ token: d.id, ref: d.ref })))
  if (tokenRefs.length === 0) return res.status(200).json({ sent: 0 })

  const senderSnap = await db.doc(`users/${uid}`).get()
  const senderName = (senderSnap.data()?.displayName as string | null) ?? 'ともだち'

  // sendEachForMulticast は 1 回 500 トークンまで
  let sent = 0
  for (let i = 0; i < tokenRefs.length; i += 500) {
    const chunk = tokenRefs.slice(i, i + 500)
    const result = await getMessaging().sendEachForMulticast({
      tokens: chunk.map(t => t.token),
      notification: {
        title: 'petamp',
        body: `${senderName}が新しい軌跡を記録しました`,
      },
      data: { type: 'friend-run', uid, runId },
      apns: { payload: { aps: { sound: 'default' } } },
    })
    sent += result.successCount
    // 失効したトークンは掃除する
    await Promise.all(
      result.responses.map((r, j) => {
        const code = r.error?.code
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          return chunk[j].ref.delete().catch(() => undefined)
        }
        return Promise.resolve()
      }),
    )
  }

  return res.status(200).json({ sent, friends: friendUids.length })
}
