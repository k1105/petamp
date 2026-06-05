#!/usr/bin/env node
// App Store Connect REST API の薄いCLIヘルパー。
// ES256 JWT を生成して fetch する。.env.asc の3変数を環境から読む。
//
// 使い方:
//   source .env.asc && node scripts/asc.mjs GET "/v1/apps?filter[bundleId]=com.rennur.petamp"
//   source .env.asc && node scripts/asc.mjs POST /v1/betaGroups '{"data":{...}}'
import { readFileSync } from 'node:fs'
import { createSign, createPrivateKey } from 'node:crypto'

const KEY_ID = process.env.ASC_KEY_ID
const ISSUER = process.env.ASC_ISSUER_ID
const KEY_PATH = process.env.ASC_KEY_PATH
if (!KEY_ID || !ISSUER || !KEY_PATH) {
  console.error('ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH が未設定 (source .env.asc)')
  process.exit(1)
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function makeJWT() {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' }
  const payload = { iss: ISSUER, iat: now, exp: now + 300, aud: 'appstoreconnect-v1' }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const key = createPrivateKey(readFileSync(KEY_PATH))
  // ES256 は P1363(raw R||S) 形式の署名が必要
  const sig = createSign('SHA256').update(signingInput).sign({ key, dsaEncoding: 'ieee-p1363' })
  return `${signingInput}.${b64url(sig)}`
}

export async function asc(method, path, body) {
  const url = path.startsWith('http') ? path : `https://api.appstoreconnect.apple.com${path}`
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${makeJWT()}`,
      'Content-Type': 'application/json',
    },
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  if (!res.ok) {
    const err = new Error(`ASC ${method} ${path} -> ${res.status}`)
    err.status = res.status
    err.body = json
    throw err
  }
  return json
}

// CLI として直接呼ばれた場合
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , method = 'GET', path, body] = process.argv
  asc(method, path, body)
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => { console.error(e.message); console.error(JSON.stringify(e.body, null, 2)); process.exit(1) })
}
