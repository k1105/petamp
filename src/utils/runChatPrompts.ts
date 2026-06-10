// このランの振り返りトークで、ペタンプの第一声を生成するときの hidden trigger。
// RunChatPage / RunResultPage の両方から参照する。
const HIDDEN_TRIGGER_PREFIX = '[internal]'

export const OPENING_TRIGGER_FRESH = `${HIDDEN_TRIGGER_PREFIX} ユーザがこのRunの振り返りを開始した。まず「お疲れさま！」「新しいランだ！」のような、ランを終えたことを労ったり喜んだりする短い一言で会話を始めよ。続けて、runSummaryから気になる点をひとつだけ取り上げ、ユーザに短く問いかけよ。挨拶と問いかけはひと続きの自然な発話としてまとめ、全体で短く保つこと。`

export const OPENING_TRIGGER_RESUME = `${HIDDEN_TRIGGER_PREFIX} ユーザがこのRunの詳細画面にひらいた。これは初対面ではない。前にこの "まさにこのRun" について話したことがあるはず([このRunについて、前に話したこと]節を参照)。前回触れた話題やユーザの反応を踏まえ、続きから自然に再開する短い一言を返せ。新しい観察として始めない。「まえ別のところで」のような他Runとの混同表現は厳禁。`

export const CLOSING_NOTE =
  'これがこのセッションのペタンプ最後の発話。ユーザの直前の発言に短く触れたあと、今日話せたことについての一言の感想で会話を締めくくれ。問いかけで終わらせず、感謝や満足のことばで結ぶこと。'

// 環世界記譜法 (実験機能) 専用 opener。挨拶を最小限にし、音素引用ルールも書き添える。
export const NOTATION_OPENING_TRIGGER_FRESH = `${HIDDEN_TRIGGER_PREFIX} ユーザがこのランの「ぼくのことば」画面をひらいた。system prompt の音素列とモチーフを見て、気になる音素並びをひとつだけ取り上げ、短く問いかけよ。挨拶は「おつかれ」程度の一言で十分、初対面の挨拶 (「はじめまして」など) は使わない。音素引用は2-3音素まで。`

export const NOTATION_OPENING_TRIGGER_RESUME = `${HIDDEN_TRIGGER_PREFIX} ユーザがこのランの「ぼくのことば」画面を再びひらいた。これは初対面ではない。前回触れた話題の続きから短く再開せよ。挨拶しない。音素引用は2-3音素まで。`

export function isHiddenTriggerContent(content: string): boolean {
  return content.startsWith(HIDDEN_TRIGGER_PREFIX)
}
