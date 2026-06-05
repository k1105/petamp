#!/usr/bin/env node
// TestFlight 外部テスト(公開リンク)を CLI で設定するスクリプト。
//   1. ベータ審査の連絡先(betaAppReviewDetail)を設定
//   2. ベータ版の説明/フィードバック先(betaAppLocalization)を設定
//   3. ビルドのテスト内容(betaBuildLocalization whatsNew)を設定
//   4. ビルドをベータ審査に提出(betaAppReviewSubmission)
//   5. 外部グループを作成し公開リンクを有効化(betaGroup publicLinkEnabled)
//   6. ビルドをグループに追加し、公開リンクURLを出力
//
// 使い方: source .env.asc && node scripts/testflight-public.mjs [buildId]
import { asc } from './asc.mjs'

const APP_ID = '6773042195'
const GROUP_NAME = 'Public'
const LOCALE = 'ja' // 説明文の言語

const REVIEW = {
  contactFirstName: 'Kanata',
  contactLastName: 'Yamagishi',
  contactPhone: '+818055080638',
  contactEmail: 'kntymgs1105@gmail.com',
  demoAccountRequired: false,
  notes: 'ログインは任意で、未ログインでも主要機能を試せます。',
}
const DESCRIPTION =
  'PETAMPは、ランニングなどの移動軌跡を地図上に記録し、訪れた場所に名前を付けて思い出として残すアプリです。友達とペアになって互いの軌跡を共有する「ペアモード」も搭載しています。ログインは任意で、未ログインでも主要機能を試せます。'
const FEEDBACK_EMAIL = 'kntymgs1105@gmail.com'
const WHATS_NEW = '・移動軌跡の記録と地図表示\n・訪れた場所への命名\n・ペアモードでの軌跡共有'

const log = (...a) => console.log(...a)
const isConflict = (e) => e.status === 409 || e.status === 422

async function pickBuild(buildId) {
  if (buildId) return buildId
  const r = await asc('GET', `/v1/builds?filter%5Bapp%5D=${APP_ID}&filter%5BprocessingState%5D=VALID&sort=-version&limit=1`)
  if (!r.data?.length) throw new Error('VALID なビルドがありません。処理完了を待って下さい。')
  log(`対象ビルド: v? id=${r.data[0].id}`)
  return r.data[0].id
}

// 1. 審査連絡先 (resource id == app id)
async function setReviewDetail() {
  try {
    await asc('PATCH', `/v1/betaAppReviewDetails/${APP_ID}`, {
      data: { type: 'betaAppReviewDetails', id: APP_ID, attributes: REVIEW },
    })
    log('✓ 審査連絡先を設定')
  } catch (e) {
    log('! 審査連絡先 PATCH 失敗:', e.status, JSON.stringify(e.body?.errors?.[0]?.detail || e.body))
    throw e
  }
}

// 2. ベータ版の説明 / フィードバック先
async function setAppLocalization() {
  const r = await asc('GET', `/v1/apps/${APP_ID}/betaAppLocalizations`)
  const existing = r.data?.find((l) => l.attributes.locale === LOCALE) || r.data?.[0]
  if (existing) {
    await asc('PATCH', `/v1/betaAppLocalizations/${existing.id}`, {
      data: { type: 'betaAppLocalizations', id: existing.id, attributes: { description: DESCRIPTION, feedbackEmail: FEEDBACK_EMAIL } },
    })
    log(`✓ ベータ版の説明を更新 (${existing.attributes.locale})`)
  } else {
    await asc('POST', '/v1/betaAppLocalizations', {
      data: {
        type: 'betaAppLocalizations',
        attributes: { locale: LOCALE, description: DESCRIPTION, feedbackEmail: FEEDBACK_EMAIL },
        relationships: { app: { data: { type: 'apps', id: APP_ID } } },
      },
    })
    log(`✓ ベータ版の説明を作成 (${LOCALE})`)
  }
}

// 3. テスト内容 (What to Test)
async function setBuildLocalization(buildId) {
  const r = await asc('GET', `/v1/builds/${buildId}/betaBuildLocalizations`)
  const existing = r.data?.find((l) => l.attributes.locale === LOCALE) || r.data?.[0]
  if (existing) {
    await asc('PATCH', `/v1/betaBuildLocalizations/${existing.id}`, {
      data: { type: 'betaBuildLocalizations', id: existing.id, attributes: { whatsNew: WHATS_NEW } },
    })
    log(`✓ テスト内容を更新 (${existing.attributes.locale})`)
  } else {
    await asc('POST', '/v1/betaBuildLocalizations', {
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale: LOCALE, whatsNew: WHATS_NEW },
        relationships: { build: { data: { type: 'builds', id: buildId } } },
      },
    })
    log(`✓ テスト内容を作成 (${LOCALE})`)
  }
}

// 4. ベータ審査に提出
async function submitForReview(buildId) {
  try {
    await asc('POST', '/v1/betaAppReviewSubmissions', {
      data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: buildId } } } },
    })
    log('✓ ベータ審査に提出')
  } catch (e) {
    if (isConflict(e)) { log('= 既に審査提出済み/提出不可:', e.body?.errors?.[0]?.detail); return }
    throw e
  }
}

// 5. 外部グループ + 公開リンク
async function ensurePublicGroup() {
  const r = await asc('GET', `/v1/apps/${APP_ID}/betaGroups?limit=200`)
  let group = r.data?.find((g) => g.attributes.name === GROUP_NAME)
  if (!group) {
    const c = await asc('POST', '/v1/betaGroups', {
      data: {
        type: 'betaGroups',
        attributes: { name: GROUP_NAME, publicLinkEnabled: true },
        relationships: { app: { data: { type: 'apps', id: APP_ID } } },
      },
    })
    group = c.data
    log('✓ 外部グループ作成 + 公開リンク有効化')
  } else if (!group.attributes.publicLinkEnabled) {
    const u = await asc('PATCH', `/v1/betaGroups/${group.id}`, {
      data: { type: 'betaGroups', id: group.id, attributes: { publicLinkEnabled: true } },
    })
    group = u.data
    log('✓ 既存グループの公開リンクを有効化')
  } else {
    log('= 公開リンク有効な外部グループが既存')
  }
  return group
}

// 6. ビルドをグループに追加
async function addBuildToGroup(groupId, buildId) {
  try {
    await asc('POST', `/v1/betaGroups/${groupId}/relationships/builds`, {
      data: [{ type: 'builds', id: buildId }],
    })
    log('✓ ビルドをグループに追加')
  } catch (e) {
    if (isConflict(e)) { log('= ビルドは既にグループに追加済み'); return }
    throw e
  }
}

async function main() {
  const buildId = await pickBuild(process.argv[2])
  await setReviewDetail()
  await setAppLocalization()
  await setBuildLocalization(buildId)
  await submitForReview(buildId)
  const group = await ensurePublicGroup()
  await addBuildToGroup(group.id, buildId)

  // 最新の公開リンクを取得
  const g = await asc('GET', `/v1/betaGroups/${group.id}`)
  const link = g.data?.attributes?.publicLink
  log('\n========================================')
  log('🔗 公開リンク:', link || '(発行待ち。数分後に再取得)')
  log('   ※ リンクは即発行されますが、参加して入手できるのは')
  log('     ベータ審査(通常1日以内)を通過してからです。')
  log('========================================')
}

main().catch((e) => {
  console.error('\n❌ 失敗:', e.message)
  console.error(JSON.stringify(e.body, null, 2))
  process.exit(1)
})
