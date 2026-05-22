# scripts

## migrate-follows-to-friends.mjs

Issue #8: `/follows` (片方向フォロー) → `/friends` (相互フレンド) への一回限りのマイグレーション。

### 前提

- `firebase-admin` を一時的にインストールする (一回限りのスクリプトなので devDependencies に常駐させない運用)。
- サービスアカウント JSON を発行し、`GOOGLE_APPLICATION_CREDENTIALS` 環境変数で指定。

### 実行

```bash
# 0. firebase-admin を一時インストール
npm install --save-dev firebase-admin

export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# 1. ドライラン (書き込みなし、件数とサンプルを確認)
node scripts/migrate-follows-to-friends.mjs --dry-run

# 2. 本実行 (friends コレクションへ書き込み)
node scripts/migrate-follows-to-friends.mjs

# 3. 検証 OK なら、follows コレクションを削除
node scripts/migrate-follows-to-friends.mjs --delete-follows

# 4. 完了後に firebase-admin を取り除く
npm uninstall firebase-admin
```

### 仕様

- `/follows/{followerUid}__{followeeUid}` の片方向でも関係があれば「友達」として `/friends/{minUid}__{maxUid}` を作成。
- 既に `/friends/{id}` が存在する場合はスキップ (再実行安全)。
- `createdAt` は両方向の follow doc のうち最も古いタイムスタンプを採用。
