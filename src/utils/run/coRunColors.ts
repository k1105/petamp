// 「一緒に走る」メンバーごとの色 (最大 8 人ぶん。超過分は循環)。
// 合成リプレイ (RunDetailPage の co-run 描画) と一覧の統合タイル (CoRunTile) で共有する。
const MEMBER_COLORS: [number, number, number][] = [
  [28, 151, 94],
  [232, 101, 90],
  [90, 142, 232],
  [232, 198, 90],
  [168, 90, 232],
  [90, 218, 210],
  [232, 140, 90],
  [200, 200, 200],
]

export function memberColor(i: number): [number, number, number] {
  return MEMBER_COLORS[i % MEMBER_COLORS.length]
}

export function rgbCss(c: [number, number, number]): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`
}
