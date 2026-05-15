import type { SpeechComposer } from '../types'
import { renderPhonemes } from '../types'

/**
 * 初期スタブ: ターン番号で発話形を切り替える最小実装。
 *  - turn 0: 「ぼくのことば」前置き + 全音素列
 *  - それ以降: ユーザ入力にかかわらず音素列を区切り直して提示
 *
 * 翻訳語を一切混ぜないストイック原則 (2026-05-15 決定) に従う。
 * 対話品質の評価は対象外、まず譜面が出ることを確認する。
 */
export const defaultV1Composer: SpeechComposer = {
  id: 'notation.composer.defaultV1',
  compose({ currentRun, turnIndex }) {
    const seq = renderPhonemes(currentRun.phonemes)
    if (currentRun.phonemes.length === 0) {
      return 'まだことばが、ない'
    }
    if (turnIndex === 0) {
      return `ぼくのことばで、いうと\n${seq}`
    }
    // ターンを重ねたら局所的な部分列に絞る (頭から / 中ほど / 末尾)
    const span = pickSpan(currentRun.phonemes.length, turnIndex)
    const sliced = currentRun.phonemes.slice(span[0], span[1])
    return renderPhonemes(sliced)
  },
}

function pickSpan(total: number, turn: number): [number, number] {
  if (total <= 4) return [0, total]
  const third = Math.max(1, Math.floor(total / 3))
  const which = turn % 3
  if (which === 0) return [0, third]
  if (which === 1) return [third, Math.min(total, third * 2)]
  return [Math.max(0, total - third), total]
}
