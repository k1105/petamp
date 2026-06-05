#!/usr/bin/env bash
#
# CLI だけで TestFlight にアップロードするスクリプト。
#
# 事前準備（初回のみ）:
#   1. App Store Connect → Users and Access → Integrations → App Store Connect API
#      で API キーを発行し、AuthKey_XXXXXXXX.p8 をダウンロード（再DL不可なので保管）。
#   2. .env.asc を作成（gitignore 済み）:
#        export ASC_KEY_ID=XXXXXXXX            # Key ID
#        export ASC_ISSUER_ID=xxxx-xxxx-...    # Issuer ID
#        export ASC_KEY_PATH=$HOME/.appstoreconnect/AuthKey_XXXXXXXX.p8
#   3. App Store Connect 側にアプリレコード(Bundle ID: com.rennur.petamp)を作成済みであること。
#
# 使い方:
#   source .env.asc && ./scripts/testflight.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
IOS_APP="$ROOT/ios/App"
ARCHIVE_PATH="$ROOT/ios/build/petamp.xcarchive"
EXPORT_PATH="$ROOT/ios/build/export"

: "${ASC_KEY_ID:?ASC_KEY_ID が未設定です (.env.asc を source して下さい)}"
: "${ASC_ISSUER_ID:?ASC_ISSUER_ID が未設定です}"
: "${ASC_KEY_PATH:?ASC_KEY_PATH が未設定です}"
[ -f "$ASC_KEY_PATH" ] || { echo "APIキーが見つかりません: $ASC_KEY_PATH"; exit 1; }

echo "==> 1/5 Web ビルド"
npm run build

echo "==> 2/5 Capacitor 同期"
npx cap sync ios

echo "==> 3/5 ビルド番号インクリメント"
( cd "$IOS_APP" && agvtool next-version -all )

echo "==> 4/5 Archive"
rm -rf "$ARCHIVE_PATH" "$EXPORT_PATH"
xcodebuild -workspace "$IOS_APP/App.xcworkspace" \
  -scheme App \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  clean archive

echo "==> 5/5 Export & Upload to App Store Connect"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$IOS_APP/ExportOptions.plist" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

echo ""
echo "✅ アップロード完了。App Store Connect の TestFlight タブで処理状況を確認して下さい。"
echo "   初回は輸出コンプライアンスの回答とテスター追加が必要です。"
