#!/usr/bin/env node
/**
 * follows コレクション (片方向フォロー) を friends コレクション (相互フレンド) に統合する
 * 一回限りのマイグレーションスクリプト。
 *
 * 仕様:
 *  - /follows/{followerUid}__{followeeUid} に status='pending' or 'accepted' が入っている
 *  - 「片方向でも関係があれば友達」とみなす (issue #8)
 *  - 既存の follow doc 全体を対象に、登場する (uid_a, uid_b) ペアを sorted UID で正規化し
 *    /friends/{minUid}__{maxUid} に { members:[lo,hi], createdAt } を作る
 *  - createdAt は両方向の follow doc の最小 createdAt を採用
 *  - 既に /friends/{id} が存在する場合はスキップ (再実行安全)
 *  - --delete-follows フラグ付きで実行すると、書き込み完了後に /follows を全削除する
 *  - --dry-run フラグ付きだとプレビューのみ、書き込みは行わない
 *
 * 認証:
 *  - GOOGLE_APPLICATION_CREDENTIALS にサービスアカウント JSON のパスを指定して実行する
 *      export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
 *      node scripts/migrate-follows-to-friends.mjs --dry-run
 *      node scripts/migrate-follows-to-friends.mjs
 *      node scripts/migrate-follows-to-friends.mjs --delete-follows
 *
 * 依存:
 *  - firebase-admin (devDependencies に追加するか、`npx -p firebase-admin -- node ...` で実行)
 */

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const deleteFollows = args.has('--delete-follows')

if (!getApps().length) {
  initializeApp({ credential: applicationDefault() })
}
const db = getFirestore()

/** sorted UID で正規化した friend doc ID。 */
function friendDocId(a, b) {
  const [lo, hi] = a < b ? [a, b] : [b, a]
  return `${lo}__${hi}`
}

async function main() {
  console.log(`[migrate] starting (dryRun=${dryRun}, deleteFollows=${deleteFollows})`)

  const followsSnap = await db.collection('follows').get()
  console.log(`[migrate] found ${followsSnap.size} follow docs`)

  // pair (sortedKey) -> { members:[lo,hi], createdAt }
  const pairs = new Map()
  for (const d of followsSnap.docs) {
    const data = d.data()
    const a = data.followerUid
    const b = data.followeeUid
    if (typeof a !== 'string' || typeof b !== 'string' || a === b) {
      console.warn(`[migrate] skip invalid doc ${d.id}`)
      continue
    }
    const id = friendDocId(a, b)
    const [lo, hi] = a < b ? [a, b] : [b, a]
    const createdAt = typeof data.createdAt === 'number' ? data.createdAt : Date.now()
    const existing = pairs.get(id)
    if (!existing) {
      pairs.set(id, { members: [lo, hi], createdAt })
    } else if (createdAt < existing.createdAt) {
      existing.createdAt = createdAt
    }
  }
  console.log(`[migrate] unique friend pairs to write: ${pairs.size}`)

  let written = 0
  let skipped = 0
  for (const [id, data] of pairs) {
    const ref = db.collection('friends').doc(id)
    const snap = await ref.get()
    if (snap.exists) {
      skipped++
      continue
    }
    if (dryRun) {
      console.log(`[dry-run] would write friends/${id}`, data)
    } else {
      await ref.set(data)
    }
    written++
  }
  console.log(`[migrate] written=${written} skipped(existing)=${skipped}`)

  if (deleteFollows && !dryRun) {
    console.log('[migrate] deleting /follows collection...')
    let deleted = 0
    const batchSize = 400
    while (true) {
      const snap = await db.collection('follows').limit(batchSize).get()
      if (snap.empty) break
      const batch = db.batch()
      snap.docs.forEach(d => batch.delete(d.ref))
      await batch.commit()
      deleted += snap.size
      console.log(`[migrate] deleted ${deleted}`)
    }
    console.log(`[migrate] /follows deleted (${deleted} docs)`)
  } else if (deleteFollows && dryRun) {
    console.log('[dry-run] would delete /follows collection')
  }

  console.log('[migrate] done.')
}

main().catch(err => {
  console.error('[migrate] failed:', err)
  process.exit(1)
})
