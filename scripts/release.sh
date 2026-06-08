#!/usr/bin/env bash
#
# ビルド → TestFlight アップロード → 処理(VALID)待ち → 外部公開リンク紐付け を
# 一気通貫で実行するリリーススクリプト。
#
# 内訳:
#   1. ./scripts/testflight.sh         … web build → cap sync → ビルド番号+1 → archive → upload
#   2. agvtool で今回のビルド番号を取得
#   3. ./scripts/wait-build-valid.mjs  … そのビルドが App Store Connect 上で VALID になるまで待機し buildId を取得
#   4. ./scripts/testflight-public.mjs … 取得した buildId を明示で渡して外部グループ(公開リンク)に紐付け
#
# 使い方:
#   source .env.asc && ./scripts/release.sh
#
# 補足:
#   - buildId を明示で渡すので「新ビルドが Processing 中に古いビルドを誤選択」する問題は起きない。
#   - 内部テスターだけで良い場合は手順4は不要(アップロードのみの ./scripts/testflight.sh を使う)。
set -euo pipefail

cd "$(dirname "$0")/.."

: "${ASC_KEY_ID:?ASC_KEY_ID が未設定です (source .env.asc して下さい)}"

echo "==> [release 1/4] ビルド & TestFlight アップロード"
./scripts/testflight.sh

# testflight.sh が agvtool でインクリメントした最新ビルド番号
VERSION="$(cd ios/App && agvtool what-version -terse)"
echo "==> [release 2/4] アップロード済みビルド番号: $VERSION"

echo "==> [release 3/4] App Store Connect の処理(VALID)を待機"
BUILD_ID="$(node scripts/wait-build-valid.mjs "$VERSION")"
echo "==> [release 3/4] VALID buildId: $BUILD_ID"

echo "==> [release 4/4] 外部公開リンク(グループ Public)に紐付け"
node scripts/testflight-public.mjs "$BUILD_ID"

echo ""
echo "✅ [release] 全工程完了 (build $VERSION)。"
