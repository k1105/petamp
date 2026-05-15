import type { Run } from '../types'

/**
 * 環世界記譜法の最小単位 (実験機能)。ペタンプの「足音そのもの」。
 * primitive symbol + 持続 + 韻律変調。symbol/marker は固定、modulation だけ変化する。
 */
export interface Phoneme {
  /** 基本音素 (NotationStrategy ごとの固定セットから選ばれる)。 */
  symbol: string
  /** 持続ミリ秒。region をまとめた集約値。 */
  durationMs: number
  /** 音程 (-1 下り / 0 平 / +1 登り)。 */
  pitch: -1 | 0 | 1
  /** 促音化 (切れ味)。true で `ペタッ` 風レンダ。 */
  sharp: boolean
  /** 弱化 (ひらがな化)。true で `ぺたん` 風レンダ。 */
  weak: boolean
  /** Run内 trackPoint index 範囲 (motif と instance 紐づけ用)。 */
  startPointIdx: number
  endPointIdx: number
}

/** モチーフ = 複数Runを跨いで再認された音素並び。ID = canonical 表記 (翻訳語をつけない)。 */
export interface Motif {
  /** canonical 音素列を文字列化したもの。同一性判定キー。 */
  id: string
  /** 構成音素の連なり (canonical 形)。 */
  pattern: Phoneme[]
  /** Run内位置の参照配列 (instance 層)。 */
  instances: Array<{ runId: string; startPointIdx: number; endPointIdx: number }>
}

/** Run → 音素列。決定的な関数 (同じRunから常に同じ列が出る)。 */
export interface NotationStrategy {
  readonly id: string
  encode(run: Run): Phoneme[]
}

/** 音素列群 → モチーフ集合。決定的。 */
export interface MotifDetector {
  readonly id: string
  detect(input: Array<{ runId: string; phonemes: Phoneme[] }>): Motif[]
}

/** 発話組み立て。petamp が今ターンで返す文字列。 */
export interface SpeechComposer {
  readonly id: string
  compose(input: {
    currentRun: { runId: string; phonemes: Phoneme[] }
    motifs: Motif[]
    userInput?: string
    turnIndex: number
  }): string
}

/**
 * Phoneme を表示用文字列にレンダリングする。
 * weak → ひらがな、sharp → 促音化、pitch → 末尾 ↑/↓、durationMs → 反復数。
 * シンプル実装: symbol を [count] 回繰り返し、変調マークを適用。
 */
export function renderPhoneme(p: Phoneme): string {
  let base = p.symbol
  if (p.weak) base = toHiragana(base)
  if (p.sharp) base = base.replace(/ン$|ん$/, 'ッ')
  const count = Math.max(1, Math.round(p.durationMs / typicalStepMs(p.symbol)))
  const repeated = base.repeat(count)
  if (p.pitch > 0) return repeated + '↑'
  if (p.pitch < 0) return repeated + '↓'
  return repeated
}

export function renderPhonemes(phonemes: Phoneme[]): string {
  return phonemes.map(renderPhoneme).join(' ')
}

function toHiragana(s: string): string {
  // カタカナ→ひらがな (Unicode shift)。`・` などの記号はそのまま。
  return s.replace(/[ァ-ヶ]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  )
}

function typicalStepMs(symbol: string): number {
  // 各 primitive 1単位ぶんの時間 (ms)。連続性を担保するための便宜的な値。
  if (symbol === '・') return 1000
  if (symbol === 'ピー') return 1000
  if (symbol === 'ペッ' || symbol === 'ぺっ') return 400
  if (symbol === 'ペタペタ') return 800
  if (symbol === 'ペタン') return 600
  return 500
}
