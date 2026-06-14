// 外部共有する公開 URL の生成元。QR / 招待リンクはこのドメインに固定する。
//
// 背景: 招待 URL を `window.location.origin` から作ると、
//   - ネイティブ (Capacitor) では origin が capacitor://localhost になり QR が無効
//   - ローカル開発では http://localhost:5173 になり他端末から踏めない
// となり、実質 Vercel 本番で開いたときしか有効な QR が出なかった。
// 共有リンクは常に本番ドメインを指すよう固定する。
//
// このドメインは iOS の Universal Links 対象でもある:
//   - ios/App/App/App.entitlements の applinks:
//   - public/.well-known/apple-app-site-association
// の3点が同じドメインで揃っている必要がある。変更時は3箇所まとめて直すこと。
//
// ローカルで /invite フローを web 検証したいときは .env.local に
//   VITE_PUBLIC_BASE_URL=http://localhost:5173
// を設定して上書きする。
const PUBLIC_BASE_URL =
  import.meta.env.VITE_PUBLIC_BASE_URL ?? 'https://petamp.vercel.app'

/** フレンド招待 URL (`https://<本番>/invite/<uid>`) を返す。 */
export function inviteUrl(uid: string): string {
  return `${PUBLIC_BASE_URL}/invite/${uid}`
}

/** Vercel Functions (api/) のエンドポイント URL を返す。 */
export function apiUrl(path: string): string {
  return `${PUBLIC_BASE_URL}/api/${path}`
}
