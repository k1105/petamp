import type { Run } from '../types'
import { activeDetector, activeStrategy } from './index'
import { renderPhonemes } from './types'
import type { Motif } from './types'

const MAX_PHONEMES_IN_PROMPT = 200
const MAX_MOTIFS_IN_PROMPT = 8

/**
 * 通常の dialogue service に渡す extraSystemNote を組み立てる。
 * 既存 persona / runSummary に加えて、現Runの音素列と、全Run横断で検出されたモチーフを与える。
 *
 * 設計意図 (2026-05-15 ymgishi 確定):
 *  - 音素はペタンプの発話のための「付加的情報」。対話機構は通常通り
 *  - 翻訳して人間語に置き換えない (音素引用や指示語が petamp の言葉)
 *  - モチーフ = 複数Run横断で2回以上現れた音素並び = ペタンプの「自前語彙」
 */
export function buildNotationSystemNote(currentRun: Run, allRuns: Run[]): string {
  const currentPhonemes = activeStrategy.encode(currentRun)
  const phonemeText = truncatePhonemes(renderPhonemes(currentPhonemes))

  const allEncoded = allRuns.map(r => ({
    runId: r.id,
    phonemes: r.id === currentRun.id ? currentPhonemes : activeStrategy.encode(r),
  }))
  const motifs = activeDetector.detect(allEncoded).slice(0, MAX_MOTIFS_IN_PROMPT)

  const sections: string[] = [
    '[ぼくのことば(実験機能)]',
    'このRunを音素列にしたもの (これがぼくの世界の言葉):',
    phonemeText || '(まだ音素なし)',
    '',
    '[音素の意味]',
    '- `ペタン` = ふつうに歩く足音 / `ペタペタ` = はやあるき',
    '- `ペッ` = ジョグ / `ぺっ` = はしり / `ピー` = ぜんりょくはしり',
    '- `・` = とまっているとき (連続するほど長い停止)',
    '- 末尾 `↑` = のぼり、`↓` = くだり',
    '- `ペタッ` のように `ッ` で終わる形 = 切れ味のある短い動き',
    '',
    '[発話のしかた]',
    '- 動きを指すときは、音素を **短く引用** してよい (例: 「ペタンペタン のとこ」「ペッ↑ のあたり」)',
    '- 「ここ」「これ」「みたい」「だ」などの指示語/語尾は使ってよい',
    '- 翻訳して「あの登りのところ」のように人間語に置き換えない。音素引用 + 指示語が ぼくの言葉',
    '- **引用は最大 2-3 音素まで**。「ペタンペタンペタンペタン…」のような長文音素列を発話に書き出さない',
    '- モチーフ (下で列挙されたもの) はそのまま固有名のように呼んでよい',
  ]

  if (motifs.length > 0) {
    sections.push(
      '',
      '[おぼえているモチーフ (同じ並びをなんども見たもの — ぼくの語彙)]',
      ...motifs.map(m => formatMotif(m)),
    )
  }

  return sections.join('\n')
}

function truncatePhonemes(text: string): string {
  if (text.length <= MAX_PHONEMES_IN_PROMPT) return text
  return text.slice(0, MAX_PHONEMES_IN_PROMPT) + ' …(以下略)'
}

function formatMotif(m: Motif): string {
  const tag = `"${m.id}"`
  const count = `${m.instances.length}回`
  const runs = new Set(m.instances.map(i => i.runId)).size
  return `- ${tag} (${count}, ${runs}Run)`
}
