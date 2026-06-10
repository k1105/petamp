# petamp リファクタリング計画

作成日: 2026-06-11
対象: src/ 全体（186ファイル・約24,000行）

## 現状診断の要約

4方向（アーキテクチャ / デッドコード / データ層 / 巨大ファイル・重複）から調査した結果、主要な問題は以下の通り。

### 深刻度: 高
1. **Capacitor/web SDK の二重実装** — `Capacitor.isNativePlatform()` の if-else が firebase/ 配下に28箇所。ほぼ同じ Firestore 操作を native 用と web 用に2回ずつ書いており、データ層のコード量が実質2倍。`getUid()` も4ファイルに同一実装が重複（runCloud.ts:26 / coRunCloud.ts:61 / friends.ts:30 / characterCloud.ts:31）。
2. **GalleryPage.tsx の肥大化（1,176行）** — useState 23個・useEffect 12個。地図描画・一覧UI・島レイアウト・キャラクター吹き出し・co-run 招待・ナビゲーション状態をすべて1ファイルで抱える。RunDetailPage（779行）・RecordingPage（692行）も同傾向。
3. **WebGL シェーダーコードの完全重複** — useMetaballSheet.ts と useJoystickMetaball.ts で `compileShader` / 色パース / `sdCircle` / `smin` 等が全く同じ実装。
4. **Run 同期の衝突処理が未定義** — `syncCloudIntoLocal` は finishedAt 比較で cloud 側を無条件上書き。リトライ付きの `cloudSaveRunEnsured()` が存在するのに通常の `saveRun()` では使われず、クラウド保存失敗は console.warn で握りつぶし。

### 深刻度: 中
5. **デッドコード** — 完全未使用ファイル3つ（utils/enrich.ts, utils/pathLayerData.ts ※他に類似実装あり, components/recording/RecordButton.tsx）、未使用 export 約40個、未使用型 約70個。
6. **デバッグページ5つが本番ルートに露出** — /shape-editor, /joystick-editor, /character-smoke, /prompt-logs, /named-places が App.tsx に無条件で定義されている。
7. **パス描画ユーティリティの乱立** — tubeMesh / splinePath / pathLayerData / tripLayerData が似た変換を別々に実装。`hexToRgb(palette.accent)` 相当の処理が4ページにコピペ。
8. **zustand ストア11個の責務境界が曖昧** — useTransitionStore と usePostRunLoadingStore は両方「フェーズ管理」、useMapStore は再生時間のみ。`useRunStore.getState()` での直接 mutation が GalleryPage に5箇所。persist の使い分けに方針がない。
9. **Firestore パス文字列のハードコード** — `users/${uid}/runs/${id}` 等が5ファイル20箇所以上に散在。
10. **リポジトリ衛生** — firebase-debug.log, prompt-logs/, .DS_Store が tracked。未使用依存（@types/mapbox-gl 等）。

### 深刻度: 低（だが要対応）
11. キャラクター記憶層の抽象化が3〜4層（MemoryStore IF → IdbMemoryStore → CompositeMemoryStore → characterSync）でエラーは全箇所握りつぶし。
12. リソースリーク懸念2件: BaseMap の `map.on('load')` cleanup 未確認、MapJoystick.tsx:199 付近の resize → rAF 多重登録。
13. utils/（38ファイル）・hooks/（26個）・components/ 直下の分類基準がない。

### 前提となる制約
- **自動テストが存在しない**（package.json に test スクリプトなし）。リファクタリングの安全網は `tsc -b` + `eslint` + 手動スモークテストのみ。
- iOS（Capacitor）ビルドがあるため、Web だけで動作確認を完結できない箇所がある（background geolocation, Live Activity, native Firestore）。
- RunDetailPage.tsx に未コミットの変更がある（着手前に確定させること）。

---

## 進め方の原則

- **1フェーズ = 1〜数PR**。各PRは独立してレビュー・revert 可能にする。
- **「移動」と「変更」を同じコミットに混ぜない**。ファイル移動・リネームは純粋な移動コミットとして分離（git の追跡とレビューのため）。
- 各フェーズ完了時に **スモークテスト チェックリスト**（Phase 0 で定義）を通す。
- 挙動を変えるリファクタ（Phase 3 の同期ロジック等）は、挙動を変えないリファクタと PR を分ける。
- TestFlight 配布前は **30分連続稼働テスト** を実施（記録しっぱなし → 終了 → 保存確認）。

---

## Phase 0: 安全網と衛生（準備）

**目的**: 以降のフェーズを安全に進めるための足場作り。コード本体は変更しない。
**規模**: 小（半日）

1. RunDetailPage.tsx の未コミット変更を commit または破棄して作業ツリーをクリーンに。
2. リポジトリ衛生:
   - `git rm --cached firebase-debug.log` と `.DS_Store` 群、`prompt-logs/` の tracked 分を整理
   - `.gitignore` に `*.log`, `.DS_Store`, `prompt-logs/` を追記（既存定義を確認の上）
3. **knip を導入**（`npx knip` 用の knip.json を追加）し、未使用ファイル/export/依存の機械的なベースラインを取る。Phase 1 の削除根拠はこの出力で確定させる（エージェント調査の人力リストは候補にとどめ、必ず機械検証する）。
4. `npm run build`（tsc -b + vite build）と `npm run lint` がクリーンに通ることを確認し、これを各フェーズのゲートとする。
5. **手動スモークテスト チェックリストを docs/ に作成**。最低限:
   - 起動 → オンボーディング/ログイン → ギャラリー表示（TRAIL/ISLAND 両タブ）
   - 記録開始 → 数分記録 → 終了 → RunResult → チャット → 保存
   - RunDetail 表示（リプレイ再生・nutrition タブ・co-run 表示）
   - フレンド招待リンク、Spotify 連携、プロフィール
   - iOS 実機: バックグラウンド記録、Live Activity

**完了条件**: クリーンな main、knip ベースライン、チェックリスト文書。

---

## Phase 1: デッドコード削除

**目的**: 以降のリファクタ対象を物理的に減らす。挙動変更ゼロ。
**規模**: 小〜中（1日）
**リスク**: 低

1. **完全未使用ファイルの削除**（knip で確認後）:
   - `src/utils/enrich.ts`
   - `src/components/recording/RecordButton.tsx`
   - `src/utils/pathLayerData.ts` は Phase 2 で buildPathPositions に統合するため、ここでは knip 確認のみでも可
2. **未使用 export の削除**: altitudeFilters の個別フィルタ関数群、terrainShared の SEA_PALETTE 等、firebase/coRunCloud の coRunDeleteSession 等、約40件。knip 出力と突き合わせて一括削除。
   - 注意: `character/index.ts` / `notation/index.ts` のバレル re-export は「公開API意図」の可能性があるため、削除前に山岸さんに確認。
3. **デバッグページの扱い**（要確認事項 → 確認後に実施）:
   - 推奨: 削除ではなく App.tsx で `import.meta.env.DEV` ガード + `React.lazy` 化。開発時は使え、本番バンドルから除外される。
   - 対象: /shape-editor, /joystick-editor, /character-smoke, /prompt-logs, /named-places の5ルート
4. **未使用依存の削除**: `@types/mapbox-gl`（mapbox-gl v3 は型同梱）ほか knip の dependencies 出力に従う。
5. 効果測定: 削除行数と `vite build` のバンドルサイズ before/after を PR に記載。

**完了条件**: build/lint クリーン、スモークテスト通過、knip の unused 件数が大幅減。

---

## Phase 2: 重複コードの共通化 + リーク修正

**目的**: コピペ重複を共有モジュールに集約。ロジックは1文字も変えず移動・参照差し替えのみ。
**規模**: 中（2〜3日）
**リスク**: 低〜中

### 2a. WebGL ユーティリティ統合
- 新規 `src/utils/glShaderUtils.ts`: `compileShader` / `linkProgram` / `parseCssColor` / SDF 関数群（GLSL文字列）を useMetaballSheet.ts と useJoystickMetaball.ts から抽出し、両 hook を差し替え。

### 2b. パス描画系の統合
- 新規 `src/utils/pathRendering.ts` に集約:
  - `buildPathPositions`（tubeMesh.ts から）
  - `buildTripLayerData`（tripLayerData.ts から）
  - `hexToRgb` + palette accent 変換（GalleryPage / RunDetailPage / RecordingPage / RunResultPage の4重複を統合）
- `pathLayerData.ts` を削除（buildPathPositions の altitude=0 版で代替）。
- splinePath.ts（SVG用）はそのまま、参照だけ整理。

### 2c. リソースリーク修正
- BaseMap.tsx: `map.on('load')` の cleanup（`map.remove()` 経路の確認含む）。
- MapJoystick.tsx:199 付近: resize listener → rAF の多重発火を単一 rAF ガードに。
- ※ 長時間稼働アプリの原則（CLAUDE.md）に基づき、修正後に30分稼働テストで確認。

**完了条件**: build/lint クリーン、4ページの描画・metaball/joystick の見た目が変化していないこと（目視）、30分稼働テスト。

---

## Phase 3: データ層の統一（firebase/）

**目的**: Capacitor 二重実装の解消と同期ロジックの明示化。本リファクタで最も投資対効果が高い。
**規模**: 大（3〜5日）
**リスク**: 中〜高（iOS 実機での検証が必須）

### 3a. Firestore アダプタ層（挙動変更なし）
- 新規 `src/firebase/firestoreAdapter.ts`: `getDoc` / `setDoc` / `deleteDoc` / `listCollection` / `onSnapshot` 相当の統一 API を提供し、内部で `Capacitor.isNativePlatform()` を1箇所だけ判定。
- 新規 `src/firebase/paths.ts`: `pathUserRun(uid, id)` / `pathCoRun(id)` / `pathFriend(id)` 等のパスビルダー関数。ハードコード20箇所を置換。
- `getUid()` を `firebase/client.ts`（または auth.ts）の共有実装に統一し、4重複を削除。
- runCloud / coRunCloud / friends / userCloud / characterCloud を順次アダプタ経由に書き換え。**1ファイル = 1PR** とし、それぞれ iOS 実機 + Web で該当機能をスモークテスト。
- `as unknown as Record<string, unknown>` キャストはアダプタ境界の1箇所に閉じ込める。

### 3b. 型変換の統一（挙動変更なし）
- `stripForCloud` / `sanitize` / hydrate パターンを各ドメインの serialize モジュールに整理（Firestore 永続型と app 内部型の対応を明示）。

### 3c. 同期ロジックの明示化（**挙動変更あり・PR 分離**）
- `saveRun()` のクラウド保存を `cloudSaveRunEnsured()`（リトライ付き）に切り替え、失敗時の扱い（リトライキュー or 明示ログ）を決める。
- `syncCloudIntoLocal` の衝突解決方針を文書化（LWW でよいか山岸さんに確認）。photoDataUrl マージを専用関数に切り出し。
- CompositeMemoryStore の write-through 失敗の扱い（現状: 完全に無視）を、最低限「失敗を記録して次回起動時に再送」まで引き上げるかは要相談。スコープ外なら文書化のみ。

**完了条件**: firebase/ 配下から `Capacitor.isNativePlatform()` 分岐がアダプタ1箇所を除き消滅。iOS 実機で 記録保存 / co-run / フレンド / キャラ記憶同期 を確認。

---

## Phase 4: 状態管理の整理（zustand ストア）

**目的**: ストア11個の責務境界を明確化。
**規模**: 中（2日）
**リスク**: 中

1. `useTransitionStore` + `usePostRunLoadingStore` → 単一のアニメーションフェーズストアに統合（両方とも phase 管理で境界がない）。
2. `useMapStore`（currentTime/isPlaying のみ）の役割を確認し、リプレイ専用なら `useReplayStore` にリネーム、または useRunStore に統合。
3. `useRunStore.getState()` による直接 mutation（GalleryPage に5箇所）を hook 経由の action 呼び出しに統一。
4. `useSettingsStore`（252行・persist v4 migrate）はリスクが高いので**分割しない**。代わりに selector の整理と、persist 方針（何を永続化するか）の短い文書化のみ。
5. Context（ActivePaletteProvider, MapContext）と zustand の使い分け基準を docs/ に3〜5行で明文化。

**完了条件**: build/lint クリーン、遷移アニメーション・ラン終了後ローディング・リプレイ再生の動作確認。

---

## Phase 5: 巨大ページの分割

**目的**: GalleryPage を筆頭に、ページコンポーネントをコンテナ + 表示部品に分割。
**規模**: 大（4〜6日）
**リスク**: 中（UI 退行が起きやすい。1ページずつ慎重に）

### 5a. GalleryPage.tsx（1,176行 → 各200〜300行 × 5〜6ファイル）
分割境界（調査で特定済み）:
- `components/gallery/GalleryMapPanel.tsx` — BaseMap + GalleryLayers + FocusGPS + NamedPlaceMapLayers + AreaLabel
- `components/gallery/GalleryListPanel.tsx` — TRAIL/ISLAND タブ、run-grid、co-run タイル、IslandView
- `components/gallery/GalleryTrailBar.tsx` — 下部シート（FAB・metaball canvas・movement selector・吹き出し）
- `hooks/useGroupNavigation.ts` — realGroups/homeGroup、currentGroupId、initialBounds
- `hooks/useGalleryInitialization.ts` — runsLoaded、initialCenter、初回案内
- 内部コンポーネント（NamedPlaceMapLayers, FocusGPS, GalleryLayers）は既に境界が明確なので最初に切り出す。

### 5b. RunDetailPage.tsx（779行）/ RunResultPage.tsx（522行）
- 共有 hook `useRunBubblePositioning`（ResizeObserver による吹き出し位置追跡 — 両ページで重複）を抽出。
- `fetchAreaName` backfill の重複を `useRunMetadata` に統合。
- DetailLayers / CoRunDetailLayers を components/map/ へ。

### 5c. RecordingPage.tsx（692行）
- BoundsFitter / FollowUpdater / RecordingLayers を components/recording/ へ切り出し。
- 記録ライフサイクル（GPS・Kalman・Live Activity）はすでに useGpsRecorder にあるため、ページ側は表示とモーダル制御に限定。

**完了条件**: 各ページの行数 400 以下、全ページの目視確認 + スモークテスト全項目。

---

## Phase 6: ディレクトリ再編と仕上げ

**目的**: 分類基準の確立。**純粋な移動のみ**（Phase 5 までで内容が安定してから行う）。
**規模**: 中（1〜2日）
**リスク**: 低（機械的。ただし import path が大量に変わるので単独PRで）

1. `utils/` をドメイン別サブディレクトリへ: `utils/run/`, `utils/geo/`, `utils/path/`（Phase 2 の pathRendering 含む）, `utils/ui/`。
2. `components/` 直下の9ファイルを `components/ui/`（ConfirmDialog, ModalPopup 等の汎用）と既存ドメインディレクトリに振り分け。
3. 小さすぎる hook（useApplyTheme 等の2〜3行 effect ラッパー）の統廃合は任意。やるなら別PR。
4. 最終確認:
   - knip 再実行 → unused ゼロを確認
   - バンドルサイズ before/after を全体集計
   - **30分連続稼働テスト**（記録 → 終了 → 保存 → ギャラリー反映）
   - TestFlight ビルド配布（scripts/testflight.sh）

---

## スコープ外（今回はやらない）

- character/ 対話サービスの再設計（DialogueService の step 抽象化）— 動いており重複も限定的。別タスクとして提案のみ。
- useSettingsStore の分割 — persist migrate が複雑でリスクに見合わない。
- テストフレームワーク（vitest）の導入 — 価値は高いが別タスク。ただし Phase 2〜3 で抽出する純関数（pathRendering, paths, serialize）はテストを書きやすい形になるので、導入時の候補として記録しておく。
- エラーハンドリングの UI 通知（toast 等）— 新機能に相当するため対象外。

## 着手前に山岸さん/マネージャーに確認すること

1. デバッグページ5つ（shape-editor 等）は DEV ガードで残す方針でよいか、完全削除か。
2. `character/index.ts` / `notation/index.ts` の未使用 re-export は将来の公開API意図か（削除可否）。
3. Run 同期の衝突解決は Last-Write-Wins（finishedAt 比較）の現状仕様を正とするか。
4. Phase 3c（保存リトライ等の挙動変更）をスコープに含めるか。
5. Spotify 連携は現役機能か（utils/spotify の整理深度に影響）。

## 工数まとめ

| Phase | 内容 | 規模 | リスク |
|-------|------|------|--------|
| 0 | 安全網・衛生 | 半日 | なし |
| 1 | デッドコード削除 | 1日 | 低 |
| 2 | 重複共通化 + リーク修正 | 2〜3日 | 低〜中 |
| 3 | データ層統一（最重要） | 3〜5日 | 中〜高 |
| 4 | ストア整理 | 2日 | 中 |
| 5 | 巨大ページ分割 | 4〜6日 | 中 |
| 6 | ディレクトリ再編・仕上げ | 1〜2日 | 低 |

合計目安: 実働 2.5〜4週間。Phase 0→1→2 は連続実施推奨。Phase 3 以降は各フェーズ後に通常開発を挟んでも安全な構成。
