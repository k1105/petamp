#!/usr/bin/env node
// 指定ビルド番号(version)の processingState が VALID になるまで ASC をポーリングし、
// その buildId を stdout に1行で出力する。進捗ログは stderr に出すので、
// stdout を `BUILD_ID=$(node scripts/wait-build-valid.mjs 9)` の形で安全に取得できる。
//
// 使い方: source .env.asc && node scripts/wait-build-valid.mjs <version> [timeoutSec]
import { asc } from './asc.mjs'

const APP_ID = process.env.ASC_APP_ID || '6773042195'
const version = process.argv[2]
const timeoutSec = Number(process.argv[3] || 1800) // 既定 30 分
const intervalSec = 30

if (!version) {
  console.error('version 引数が必要です (例: node scripts/wait-build-valid.mjs 9)')
  process.exit(1)
}

const err = (...a) => console.error(...a)

async function fetchBuild() {
  const path =
    `/v1/builds?filter%5Bapp%5D=${APP_ID}` +
    `&filter%5Bversion%5D=${encodeURIComponent(version)}` +
    `&limit=1&fields%5Bbuilds%5D=version,processingState`
  const r = await asc('GET', path)
  return r.data?.[0] || null
}

const deadline = Date.now() + timeoutSec * 1000
err(`build ${version} の VALID 化を待機 (最大 ${timeoutSec}s, ${intervalSec}s間隔)…`)

for (;;) {
  let b = null
  try {
    b = await fetchBuild()
  } catch (e) {
    err('! ASC 照会失敗(再試行):', e.message)
  }
  const state = b?.attributes?.processingState
  err(`  build ${version}: ${state || 'まだ ASC に未出現'}`)

  if (state === 'VALID') {
    console.log(b.id) // ← stdout は buildId のみ
    process.exit(0)
  }
  if (state === 'INVALID' || state === 'FAILED') {
    err(`❌ build ${version} が ${state}。アップロードの処理に失敗しています。`)
    process.exit(1)
  }
  if (Date.now() > deadline) {
    err(`❌ タイムアウト (${timeoutSec}s)。現在の状態: ${state || '未出現'}`)
    process.exit(1)
  }
  await new Promise((r) => setTimeout(r, intervalSec * 1000))
}
