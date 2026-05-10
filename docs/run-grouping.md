# Run Grouping (top-page map constraint)

トップページ (`/`) のマップ操作を「自分が走ったエリアのみ」に制限するための、軌跡のグルーピングに関する設計メモ。

## 採用方式: bbox + margin の重なり判定 (Option C)

各run の bbox を margin (例: 150-300m) で膨張させ、膨張bbox 同士が交差する run を同じグループとして扱う。Union-Find で連結成分を取り、グループのbbox はメンバーbbox 全体の合併。

### 検討した代替案

- **(A) エリアラベル一致**: 区/市町村境を跨いだ瞬間に分裂する。命名規則の安定性に依存しすぎる。
- **(B) bbox中心距離 < threshold**: 短いラン+長い放射状ラン のような中心ズレが起きるとリンクしない。

(C) は両方の弱点を回避できるため採用。

### Cの限界

- 同じ街でも、地理的に離れた東西2エリアを走り、間を埋める3本目が出るとやがて全部1グループ化する (= 本来の意図と乖離する可能性)。
- 解決するなら **(D) path-point 直接距離**: 2run間の任意の点同士の最小距離 < margin → リンク。bboxの四角形同士が偶然重なっても実パスが離れていれば別グループ。実装コストも O(N²·M)。
- 現状はCで運用、偽相関が顕在化したらDに格上げ。

## 計算コスト最適化: 二段フィルタ (将来用メモ)

新規record追加時の判定を最適化したい場合の構成。

```
新規rec の bbox を計算
↓
[Stage 1] Group の "union bbox" との重なり判定 (O(G))
  ├─ false negativeは出ない (union bbox は member bbox の上位集合なので、
  │   memberに重なっていれば必ず union bboxにも重なる)
  └─ false positive は出る可能性あり (対角配置で充填率の低いgroupだと、
      実は誰とも重ならない新recが union bbox には重なってしまう)
↓
[Stage 2] Stage 1 通過候補について、メンバー個別bbox で再評価 (O(M_g))
  └─ 偽陽性を排除
↓
重なるmemberが居れば そのgroupに追加
複数groupと重なれば それらをマージ
どれとも重ならなければ 新規group作成
```

### 採用判断

- 新規record追加は秒〜分単位の頻度なので、現状は **gallery起動時に O(N²) で全rec再クラスタリング** で十分。N=500 でも ~3ms 程度。
- 将来 N が数千を超える / グループ数が増える場合に二段フィルタへ移行すると効果的。
- groupId を永続化する場合は二段フィルタ必須 (差分更新が必要になる)。現状はuseMemoでderiveしてるので不要。

## 関連ファイル

- `src/utils/runBbox.ts` — bbox計算 / margin膨張ユーティリティ
- `src/utils/runGroups.ts` — Union-Findクラスタリング (Phase 2 で追加予定)
- `src/components/map/MapBoundsConstraint.tsx` — Mapbox の `setMaxBounds`/`setMinZoom` 適用

## マップ制約の実装

```ts
// 現状: 全run合併bbox を一括制約 (Phase 1)
const bbox = computeRunsBbox(runs)
const padded = expandBboxByMeters(bbox, ui.mapPaddingMeters)
map.setMaxBounds(padded)
const camera = map.cameraForBounds(padded, { padding: 0 })
map.setMinZoom(camera.zoom)

// Phase 2 以降: グループ単位に切替
// 表示中グループのbbox + paddingで setMaxBounds/setMinZoom
// グループ間遷移はパン端到達でジャンプ (シームレス遷移は使わない)
```
