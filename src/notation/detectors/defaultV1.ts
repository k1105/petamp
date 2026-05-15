import type { MotifDetector, Motif, Phoneme } from '../types'

/**
 * 初期スタブ: モチーフ検出は次イテレーションで本実装する。
 * 現在は空配列を返すだけ (SpeechComposer が motif を参照しない構成と整合)。
 *
 * 将来の defaultV2 では: 候補長 2-8、同一 petamp の全Runs内で 2回以上出現するシーケンスを抽出。
 * canonical id = renderPhonemes(pattern) を辞書キーにする。
 */
export const defaultV1Detector: MotifDetector = {
  id: 'notation.detector.defaultV1',
  detect(_input: Array<{ runId: string; phonemes: Phoneme[] }>): Motif[] {
    return []
  },
}
