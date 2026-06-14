/**
 * アンカー (目標地点) との距離を、打音フィードバックの BPM に変換する。
 *
 * 仕様:
 * - 近づくほど BPM が上がる (急かされる)。
 * - 到達半径以下まで近づくと無音 (= ゴール)。
 * - 射程より遠いときは最小 BPM で鳴り続ける (「まだ遠い」合図)。
 */

/** これ以下まで近づいたら到達とみなし無音にする (m)。 */
export const ANCHOR_ARRIVAL_RADIUS_M = 15
/** これ以上遠いときは最小 BPM で頭打ちにする (m)。
    この距離以内に入ると距離に応じて BPM が変化し始める (= 近づいた手応えが出る)。 */
export const ANCHOR_MAX_RANGE_M = 10000
/** 最も遠い (射程端) ときの BPM。 */
export const ANCHOR_MIN_BPM = 30
/** 到達直前の最も近いときの BPM。 */
export const ANCHOR_MAX_BPM = 240

/** 接近/離脱メロディを鳴らす間隔 (ms)。 */
export const ANCHOR_PROGRESS_INTERVAL_MS = 60000
/** この距離以上変化したら接近/離脱とみなす (m)。GPS ノイズで誤判定しないための閾値。 */
export const ANCHOR_PROGRESS_THRESHOLD_M = 15

/**
 * 距離 (m) を BPM に変換する (対数カーブ)。
 * 線形だと射程を広げたとき近距離の変化が潰れるため、近距離でも遠距離でも
 * 均等に「近づいた手応え」が出るよう対数にする。
 * @returns 0 = 無音 (到達)。それ以外は ANCHOR_MIN_BPM〜ANCHOR_MAX_BPM。
 */
export function distanceToBpm(distance: number): number {
  if (distance <= ANCHOR_ARRIVAL_RADIUS_M) return 0
  if (distance >= ANCHOR_MAX_RANGE_M) return ANCHOR_MIN_BPM
  // ratio: 0 (到達半径) 〜 1 (射程端)
  const ratio =
    Math.log(distance / ANCHOR_ARRIVAL_RADIUS_M) /
    Math.log(ANCHOR_MAX_RANGE_M / ANCHOR_ARRIVAL_RADIUS_M)
  // 近い (ratio=0) で MAX、遠い (ratio=1) で MIN。
  return Math.round(ANCHOR_MAX_BPM + ratio * (ANCHOR_MIN_BPM - ANCHOR_MAX_BPM))
}

/** 到達 (無音) しているか。 */
export function isArrived(distance: number): boolean {
  return distance <= ANCHOR_ARRIVAL_RADIUS_M
}
