# プッシュ通知 / 軌跡接近通知

2 種類の通知を実装している。

1. **フレンドの新記録通知** — 友達が新しいランを記録したらプッシュ通知 (FCM / リモート通知)
2. **軌跡接近通知** — 過去の自分/友人の軌跡の近くを通ったらローカル通知 (iOS ジオフェンス)

## 1. フレンドの新記録通知

```
ラン保存 (runRepository.pushRunToCloud)
  └→ cloudSaveRunEnsured 成功後、POST https://petamp.vercel.app/api/notify-run
       (Authorization: Bearer <Firebase ID トークン>, body: { runId })
        └→ api/notify-run.ts (Vercel Function, firebase-admin)
             1. ID トークン検証
             2. users/{uid}/runNotifications/{runId} を create (排他 = 重複送信防止。
                run doc 本体はクライアントが丸ごと上書きするので別コレクションに置く)
             3. friends から相手 UID を取得
             4. users/{friendUid}/fcmTokens/* のトークンへ sendEachForMulticast
             5. 失効トークン (registration-token-not-registered) は削除
```

- デバイストークンは `usePushNotifications` がサインイン後に
  `users/{uid}/fcmTokens/{token}` へ登録する (`@capacitor-firebase/messaging`)。
- 6 時間より古いラン (`finishedAt` 基準) は通知しない (過去データ再同期での誤発火防止)。
- 編集や再保存で何度 API が呼ばれても、`runNotifications` の create 排他で通知は 1 回だけ。

## 2. 軌跡接近通知 (常時 GPS なし)

```
useTraceGeofences (App マウント時 + ソーシャルフィード更新時)
  ├→ 自分のローカルラン + フレンドのクラウドランを約150m グリッドでクラスタリング
  │   (utils/traceGeofence.ts、候補は最大300件、通知文も JS 側で生成)
  └→ TraceGeofence.setCandidates → ネイティブの UserDefaults に永続化
       └→ TraceGeofenceManager.swift
            - 現在地に近い候補 最大18件を CLCircularRegion (半径150m) として監視
            - 大幅位置変更 (SLC) のたびに監視対象を選び直す
            - リージョン進入 → ローカル通知 (同一地点は12時間クールダウン)
            - SLC/リージョンイベントはアプリが kill されていても OS が
              バックグラウンド再起動して届ける → AppDelegate で start() している
```

- 常時 GPS は使わないので電池への影響はほぼない。
- 必要権限: 位置情報「常に許可」(`requestAlwaysPermission` でアップグレード要求) と通知許可。
- 自宅特定と「家にいるだけで毎回通知」を防ぐため、各ランの先頭/末尾 200m は候補から除外。
- 記録から 24 時間以内の自分のランは「かつての軌跡」ではないので除外。
- チューニング定数は `src/utils/traceGeofence.ts` 先頭と
  `ios/App/App/Plugins/TraceGeofenceManager.swift` 先頭にまとまっている。

## リリース前に必要な手動セットアップ

### A. APNs 認証キー (FCM 用 / 山岸さんの Apple Developer アカウントで)

1. [Apple Developer → Certificates, Identifiers & Profiles → Keys](https://developer.apple.com/account/resources/authkeys/list)
   で `+` → 「Apple Push Notifications service (APNs)」にチェック → キー作成 → `.p8` をダウンロード
   (Key ID を控える。ダウンロードは一度しかできない)
2. [Firebase Console](https://console.firebase.google.com/project/petamp-44666/settings/cloudmessaging) →
   プロジェクト設定 → Cloud Messaging → Apple アプリの構成 → 「APNs 認証キー」に
   `.p8` / Key ID / Team ID をアップロード
3. App ID `com.rennur.petamp` に **Push Notifications** capability が有効か確認
   ([Identifiers](https://developer.apple.com/account/resources/identifiers/list))。
   自動署名なら Xcode が provisioning profile を再生成してくれる。
   ※ entitlements (`aps-environment: development`) は追加済み。App Store 配布時は
   署名時に自動で production に置き換わる。

### B. Vercel 環境変数 (送信 API 用)

1. [Firebase Console → プロジェクト設定 → サービスアカウント](https://console.firebase.google.com/project/petamp-44666/settings/serviceaccounts/adminsdk)
   → 「新しい秘密鍵の生成」で JSON をダウンロード
2. `vercel env add FIREBASE_SERVICE_ACCOUNT production` で JSON の中身を 1 行のまま貼り付け
   (preview でもテストするなら preview にも)
3. 再デプロイで `api/notify-run` が有効になる

### C. Firestore ルールのデプロイ

`firestore.rules` に `users/{uid}/fcmTokens` のルールを追加済み。
`firebase deploy --only firestore:rules` (または Console から) で反映する。

## 動作確認手順

1. 実機 2 台 (またはフレンド関係にある 2 アカウント) で TestFlight ビルドを起動し、
   通知許可と位置情報「常に許可」を与える
2. 端末 A でランを記録して終了 → 端末 B にプッシュ通知が届くこと
3. 端末 A のラン名を編集して再保存 → 通知が再送され**ない**こと
4. 過去に走ったコース (記録から 24h 以上経過) の途中へ移動 →
   アプリを起動していない状態でローカル通知が届くこと
5. 同じ場所を 12 時間以内に再訪 → 通知されないこと
