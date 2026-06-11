# 状態管理の方針

## zustand と React Context の使い分け

- **zustand**: アプリ状態 (データキャッシュ・UI 状態・フェーズ管理)。コンポーネントツリーの外から
  も touch する必要があるもの。
- **React Context**: 「インスタンスの供給」(DI)。mapbox instance (`MapContext`)、非同期解決を
  1 回だけ行いツリー全体に配る値 (`ActivePaletteProvider`) など。
- 新しい状態を足すときは「ツリー外 (store action, リスナー) から書くか?」→ yes なら zustand。

## ストア一覧と責務

| ストア | 責務 | persist |
|--------|------|---------|
| useRunStore | ラン一覧キャッシュ + CRUD (実体は db/runRepository) | なし (IDB が正) |
| useSocialFeedStore | フレンドのラン・ユーザーのキャッシュ | なし |
| useCoRunStore | 「一緒に走る」セッション購読・招待 UI | なし |
| useReplayStore | リプレイ再生位置 (RunDetailPage + useAnimation 専用) | なし |
| useGpsStore | 現在位置 | なし |
| useBootStore | 起動準備 (auth/geo/data) の ready フラグ | なし |
| useTransitionStore | ページ遷移アニメ (FAB → /record, /run/:id) の phase + ペイロード | なし |
| usePostRunLoadingStore | FINISH → 対話準備のローディング overlay phase | なし |
| useJoystickStore | FAB joystick の armed 状態 | なし |
| useSettingsStore | 設定 (radii/filter/ui/theme/experimental) | **あり** (migrate v1〜) |
| useSpotifyStore | Spotify 認証 + 再生スナップショット | **あり** (auth のみ partialize) |

- **persist の方針**: 永続化するのは「ユーザーが明示的に設定したもの」(settings) と
  「再ログインを省くための資格情報」(Spotify auth) のみ。データキャッシュは IDB / Firestore が
  正なので persist しない。
- **useTransitionStore と usePostRunLoadingStore は統合しない**: どちらも phase を持つが、
  前者はページ遷移 (origin/areaName/movementType 等のペイロード)、後者は FINISH 後の
  readyPending ハンドシェイクと、ライフサイクルも消費者も別のステートマシン。

## getState() の使い方

- イベントハンドラ・effect・リスナー内での `useXStore.getState().action()` は正規の
  イディオム (購読を増やさない一時アクセス)。禁止しない。
- render 中の `getState()` は不可。マウント時スナップショットが必要な場合のみ
  `useState(() => useXStore.getState().field)` を許容 (RecordingPage の遷移ペイロード参照)。
