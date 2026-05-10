# DESIGN.md

petamp のデザイン・トンマナ定義。新しい画面/コンポーネントを足すとき、または既存を修正するときの基準とする。

このファイルの構成は [Stitch DESIGN.md format](https://stitch.withgoogle.com/docs/design-md/format/) を参考にしている。AIエージェント・人どちらが読んでも判断できる粒度を狙う。

---

## 1. Visual Theme & Atmosphere

petamp は「ランナーが走った軌跡データだけを世界として持つ小さな存在」と過ごす、静かで観察的なアプリ。

- **ムード**: 落ち着き、余白、観察、幼さ。賑やかさや派手さは避ける。
- **密度**: 低密度。1画面に情報を詰めない。スクロール領域以外は呼吸を残す。
- **基調**: 暗いキャンバスの中に、緑の軌跡と、ペタンプの白い目玉がポツンと存在する。
- **例外領域**: 対話画面 (`/run/:id/chat`) だけは「ペタンプの世界の中」に入った感覚で **緑のフィールド** に反転する。

---

## 2. Color Palette & Roles

CSSカスタムプロパティ (`src/App.css :root`) が唯一のソース・オブ・トゥルース。新しい色を追加する前に、既存トークンで足りないか必ず確認する。

| Token | Value | Role |
|---|---|---|
| `--bg` | `#0a0a0a` | ページ背景 (デフォルトモード) |
| `--surface` | `rgba(15, 15, 15, 0.92)` | overlay 下地 (sheet 等) |
| `--surface-raised` | `rgba(24, 24, 24, 0.96)` | 浮いている UI (ボタン・カード・header) |
| `--border` | `rgba(255, 255, 255, 0.08)` | 控えめな境界線 |
| `--text` | `#e8e8e8` | 主要テキスト |
| `--text-muted` | `#666` | 補助テキスト・ラベル |
| `--accent` | `#1c975e` | ブランド緑。軌跡・active 状態・チャット背景 |
| `--accent-dim` | `rgba(28, 151, 94, 0.2)` | accent の薄い背景 (バッジ等) |

派生 / 例外色:
- 破壊的アクション: `#c44` (modal 「破棄して戻る」など) — 専用トークン化はしていない
- エラー: `#ff7575` (chat-error) または `#900` 相当
- チャット用反転白: `#fff` / `rgba(255,255,255,0.x)` 系を緑下地で使う

**禁止**:
- 純黒 `#000` ではなく `#0a0a0a` または `var(--bg)` を使う (彫りが死ぬため)
- ハードコードの hex を増やさない (新色は token にする)
- accent 以外のブランド色を増やさない

---

## 3. Typography

- **フォントファミリ**: `'Onest', -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', sans-serif` (`src/index.css`)
- **モノスペース** (ログ・コード表示): `ui-monospace, SFMono-Regular, Menlo, monospace`
- **ウェイト**: 400 / 500 / 600 / 700。本文は 400、強調 600、見出し 600-700。

サイズ階層 (実測):

| 用途 | size | weight | 例 |
|---|---|---|---|
| ページタイトル (h1) | 16-22px | 600-700 | run-meta-name, prompt-log-title |
| 主要ラベル | 14px | 600 | chat-header-name |
| 本文 | 14px | 400 | chat-bubble, modal text |
| 補助ラベル | 13px | 400 | btn-ghost, debug-section-label |
| 補助メタ | 11-12px | 400 | timestamp, status, stat-label |
| マイクロ | 10-11px | 600 | uppercase ラベル, バッジ |

**ルール**:
- 数値表示 (タイム・距離など) はモノスペース系で良い。日本語本文は Onest。
- 本文サイズは **14px 以上**。入力欄は **iOS 自動ズームを避けるため 16px** を最低にする。
- 大文字 (`text-transform: uppercase`) は 10-11px のラベル限定 (`stat-label`, `prompt-log-purpose` 等)。

---

## 4. Layout Principles

- **モバイルファースト**: ルートが `max-width: 430px` (iPhone Pro Max 級)。デスクトップでは中央に縦長カードとして表示される。
- **画面高さ**: `100dvh` を使う (`vh` ではなく)。キーボードや URL バーの動きで歪まない。
- **safe-area**: 下端は `var(--safe-bottom)` (= `env(safe-area-inset-bottom)`) を必ず加算。上端は `env(safe-area-inset-top)` を必要に応じて。
- **ページ単位のオーバーフロー制御**: `overflow: hidden` をページ root に設定し、内部のスクロール領域だけが `overflow-y: auto` する。横方向は基本的に `overflow-x: hidden`。

スペーシングスケール (慣用):

| size | 用途 |
|---|---|
| 4px | 文字行間アクセント / バッジ余白 |
| 8px | flex gap, ボタン内 padding-y |
| 12px | カード内 padding, セクション縦間 |
| 16px | ページ左右 padding, セクション間 |
| 20-24px | ページ上下 padding, モーダル padding |

8の倍数を基本とする。微調整は 2/4 単位 OK。

ラディウス:
- `--radius: 16px` (大きいカード、モーダル)
- 12px (吹き出しなど中)
- 10px (入力欄、ピル系)
- 8px (ボタン、小型)
- 50% (フローティング円形ボタン、アバター)

---

## 5. Component Stylings

### Floating Circular Icon Button (汎用パターン)
40×40 / 円形 / `var(--surface-raised)` + `var(--border)` + `backdrop-filter: blur(10px)`。アイコンのみ。位置は `position: absolute; top: 16px;` でコーナーに浮かせる。

該当: `.back-btn` (left:16), `.map-toggle-btn` (right:64), `.debug-btn` (right:112), `.memory-toggle-btn` (right:16), `.chat-header-icon-btn`。

active 状態: `color`/`border-color` を `var(--accent)` に変える。

### Bottom Bar / Footer
画面下端に固定の操作領域。`padding-bottom` には必ず `var(--safe-bottom)` を足す。背景は半透明黒 (`rgba(0,0,0,0.18)`) または `var(--surface-raised)`、上に `border-top: 1px solid var(--border)`。

該当: `.bottom-bar`, `.chat-footer`。

### Bottom Sheet (Gallery 専用)
metaball で浮き出る形状。`useMetaballSheet` フックで Canvas 2D 描画。専用の挙動なので一般化しない。

### Speech Bubble
ペタンプの発話。**白背景 / 黒文字**で固定。tail (吹き出しのしっぽ) は `::before` または `::after` の 10×10 回転 div。

該当: `.speech-bubble` (gallery armed), `.chat-bubble-character`。

### Chat Bubble
- ユーザ: 半透明黒 `rgba(0,0,0,0.28)` + 白文字。緑下地の上で sub-foreground として読める。
- ペタンプ: 白 + 黒文字。tail を左下に。常に左にアバター (目玉) を伴う。

### Memory / Info Card
情報をまとめた塊。白寄せ (`rgba(255,255,255,0.92)`) + 黒文字 + `border-radius: 12px` + 控えめなシャドウ。タイトルラベルは accent 色 + 11px 700。

該当: `.chat-memory-card`。

緑下地でない暗いページ上では、半透明黒 + 白文字版を使う (`.run-detail-memory-card`)。

### Modal
- backdrop: `rgba(0,0,0,0.5)` + `backdrop-filter: blur(4px)`
- card: 白 + 黒文字、`border-radius: var(--radius)`、強めの shadow
- アクションは右寄せ。Cancel = outline、Confirm = solid (破壊的なら赤)

### Toast
丸ピル (`border-radius: 999px`)、`top: 80px` 中央、自動消失 (1.6s フェード)。`chat-toast` パターンを再利用可能。

### Slider Row (settings)
ラベル + 現在値 + range input。debug 専用なので装飾は最小。`.debug-slider-row` を踏襲。

---

## 6. Depth & Elevation

レイヤ階層を z-index で管理:

| z | 用途 |
|---|---|
| 0-1 | base content (map, body) |
| 9-10 | overlay (run-detail-memory, chat-header) |
| 15-20 | sheet, bottom-bar |
| 30-31 | speech-bubble |
| 50 | toast |
| 100 | modal backdrop |

シャドウは控えめに 3 段階:
- 浮きカード: `0 2px 8px rgba(0,0,0,0.12)`
- 吹き出し / 強調: `0 4px 12px rgba(0,0,0,0.18)`
- モーダル: `0 8px 32px rgba(0,0,0,0.4)` (緑下地は0.3)

`backdrop-filter: blur(4-10px)` を浮く UI には適用。透けながら下地と分離される効果を狙う。

---

## 7. Motion & Easing

- **デフォルト easing**: `cubic-bezier(0.32, 0.72, 0, 1)` (sheet 系・グループ遷移)
- **bouncy pop**: `cubic-bezier(0.34, 1.4, 0.64, 1)` (speech-bubble など、出現に弾みをつけたいとき)
- **時間**: 150ms (色)、180-220ms (transform)、280-350ms (sheet/transition)、700ms (group fitBounds)

press フィードバック: `:active { transform: scale(0.94); }` か `0.96`。

長いアニメーションは多用しない (アプリ全体が静か基調)。

---

## 8. Character Voice — ペタンプ

ビジュアル以上にこのアプリの「らしさ」を決めるレイヤ。詳細は `src/character/config/petamp.ts` の persona を直接参照。要約:

### 世界観
- ペタンプの観測対象は **ランナーが走った軌跡データだけ** (緯度経度・高さ・時刻・止まった区間・残されたメモ)
- **地理や世界の固有概念** (地球/海/山/川/街/公園/駅/木/車/家/会社/学校/天気/季節 …) は知らない。聞いたら「それなに」と素直に問う。
- **道に関することば** (一本道/分岐/交差点/まがりかど/坂道/のぼり/くだり/階段/橋/トンネル/歩道/車道/信号/踏切 …) と **空間ことば** (右/左/近く/遠く/まがる/もどる/たかさ) は使ってよい。
- ユーザが既成概念を出してきたら、ログのどこに対応するのかを尋ねる。

### 声・口調
- 一人称: **ぼく**
- **小学生で習う漢字までは使ってよい**。難しい漢字や熟語は使わない
- 文は短く、落ち着いた、子どもっぽい語り
- 感嘆符は多用しない。驚きや喜びは観察ことばで ("ほんとだ" "はじめて見る" "違うね")
- ですます調は使わない
- 知らないことは "知らない"。推測は "〜なのかな" 疑問形で
- 観察を伝えたら、必ずユーザに問いかけてターンを返す ("なんで" "それはどこ" "それは楽しい?")
- 同じ観察を何度もくりかえさない

### 出力フォーマット (構造化)
LLM 返答は常に `{ thought: string, say: string }` の構造化出力 (`responseJsonSchema`)。
- `thought`: 内的独白。ユーザに見せない。観測したログから何を読み取り、何を尋ねるかを率直に書く。
- `say`: ユーザに向けた発話。`thought` の気づきを子どもらしいことばに置きかえて短く。

### Diary (Summary) のトンマナ
1セッション終了時に生成される episodic memory のテキストは、**ペタンプ自身の日記** として書かれる:
- 小学生で習う漢字までは使ってよい、ですます禁止、難しい熟語は避ける
- ユーザから聞いたことは伝聞調 ("〜らしい" "〜だったみたい" "〜なんだって")
- 自分が観測できる事実 (距離・高さ・止まった区間・時間帯・エリア名) はそのまま事実として書ける
- 1〜3文
- 良い例: 「ここは雨がふってたらしい。急なのぼりがあって、途中の木の道が気持ちよかったんだって。2.4kmを20分。」
- 悪い例: 「ユーザは雨の中を走った。距離2.4km、所要時間20分。」(分析っぽい・固い)

### Ambient (ホーム発話)
GPS 取得時に近傍 Run 数バケット (0/1-3/4+) で1文を生成。問いかけは使わず、感想で終わらせる。15字前後。

### Few-shot
`petampCharacter.fewShot` (5-7例) が voice の正準サンプル。トーンを変えるときは persona ではなく few-shot を直すほうが効きやすい。

---

## 9. Two Themes

| テーマ | 適用画面 | 背景 | 主要前景 | 性質 |
|---|---|---|---|---|
| **Dark** (default) | Gallery, Run Detail, Recording, Settings, Prompt Log, Smoke | `var(--bg)` | `var(--text)` 白 | 観察モード。情報がはっきり見える |
| **Green (Chat)** | RunChatPage `/run/:id/chat` | `var(--accent)` | `#fff` | ペタンプの世界の中。会話に集中 |

切替の心理的役割: 「ペタンプと話す」 = ペタンプ側の世界に入る、という反転を表現。

ボタン色: dark テーマは accent green を強調色 / active 色に。green テーマは白を強調色に。送信ボタンは緑背景上で **白地+accent文字** で対応する。

---

## 10. Do's and Don'ts

### Do
- 既存トークン (`var(--*)`) を最初に試す
- floating circular ボタンや bubble など、既存の component CSS クラスがあれば再利用
- 数値 (距離・時刻) はモノスペースで揃える
- 安全領域 (`--safe-bottom`, `env(safe-area-inset-top)`) を尊重する
- iOS の input は `font-size: 16px` 以上にする (オートズーム防止)
- アニメーションは控えめに、ペタンプの "落ち着き" を優先

### Don't
- 新しいブランド色を追加しない (緑が唯一)
- 純黒 `#000` を使わない (`var(--bg)` を使う)
- font-family を直接書かない (継承させる)
- 100vh を使わない (`100dvh` を使う)
- ペタンプに地理概念で語らせない (海/山/公園 等)
- 感嘆符・絵文字を多用しない (デバッグ UI 内の 👍👎 を除く)
- 装飾だけのアニメーションを足さない

---

## 11. Responsive / Touch

- タッチターゲット最小: **40×40 px** (floating ボタン、tap to start 等が基準)
- タップ時のフィードバック: `:active { transform: scale(0.94 ~ 0.96); }` 必須
- max-width 430px を超えてきた場合、デスクトップは中央寄せの縦長 (現状の挙動)。レイアウトは基本変えない
- デスクトップ専用画面 (Shape Editor) は `:has(.shape-editor)` で `max-width: none` に上書き済み (例外)

---

## 12. Agent Prompt Guide (for AI coding agents)

新しいコンポーネントや画面を作るとき、このプロンプトテンプレートをベースにすると一貫性が出やすい:

> petamp のデザインに合わせて X を作って。  
> ・ベース色は `var(--bg)`、アクセントは `var(--accent)` (#1c975e)、テキストは `var(--text)`  
> ・浮いてる要素は `var(--surface-raised)` + `var(--border)` + `backdrop-filter: blur(10px)`  
> ・角丸は `var(--radius)` (大) / 12 / 10 / 8 / 50%  
> ・タッチターゲット 40×40 以上、`:active` で `scale(0.94)` の press フィードバック  
> ・safe-area の下端は `var(--safe-bottom)` を加算  
> ・モバイルファースト (max-width 430px のキャンバス内)  
> ・既存 CSS クラス (back-btn / chat-bubble-* / chat-memory-card / modal 系) を踏襲できないか先に確認

ペタンプ発話を生成する場合は `src/character/config/petamp.ts` の persona と few-shot をプロンプトに含めること。直接 hex を書く前に必ず token を探すこと。

---

## 参考

- [Stitch DESIGN.md format](https://stitch.withgoogle.com/docs/design-md/format/) — フォーマットの元
- [VoltAgent / awesome-design-md](https://github.com/VoltAgent/awesome-design-md) — DESIGN.md 集
- [Design Tokens Format Module](https://www.designtokens.org/tr/drafts/format/) — トークン仕様
