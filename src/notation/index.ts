/**
 * 環世界記譜法 (experimental.notation)。
 *
 * 設計原則 (2026-05-15 決定):
 *  - 採用: #2 モチーフ化 / #3 韻律的修飾
 *  - 凍結: #1 チャンク化 / #4 階層構文 / #5 記譜記号
 *  - 「Run → 音素列」は決定的関数 (LLM不要)
 *  - 翻訳語をつけない (足音そのものが指示語)
 *  - 既存 character (Diary/Ambient/RunChat) には触らない
 *
 * 3 module 構造 (interface 抽象化、初期実装 defaultV1)。差し替え時は index.ts の export を切替える。
 */
export type { Phoneme, Motif, NotationStrategy, MotifDetector, SpeechComposer } from './types'
export { renderPhoneme, renderPhonemes } from './types'

import { defaultV1Strategy } from './strategies/defaultV1'
import { defaultV1Detector } from './detectors/defaultV1'
import { defaultV1Composer } from './composers/defaultV1'

export const activeStrategy = defaultV1Strategy
export const activeDetector = defaultV1Detector
export const activeComposer = defaultV1Composer
