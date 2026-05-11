import { petampCharacter } from './config'
import type { LLMCallMeta, LLMClient, LLMMessage, LLMReply } from './llm/client'

export interface HomeAmbientInput {
  /** 現在のGPS座標近傍にある過去Run数 (近さの閾値は呼び出し側で決める)。 */
  nearbyRunCount: number
}

export interface HomeAmbientResult {
  say: string
  reply: LLMReply
  messages: LLMMessage[]
  meta: LLMCallMeta
}

const TEMP = 0.95

/**
 * ホーム画面の単発「ambient」一言を生成。スレッドや履歴を持たない単発呼び出し。
 * persona + few-shot を入れて、現在地の近傍Run数バケットを伝えて1文を作らせる。
 * 戻り値には messages/meta も含めるので、呼び出し側でログに残せる。
 */
export async function generateHomeAmbient(
  llm: LLMClient,
  input: HomeAmbientInput,
): Promise<HomeAmbientResult> {
  const messages: LLMMessage[] = [
    { role: 'system', content: petampCharacter.persona },
  ]
  for (const ex of petampCharacter.fewShot) {
    messages.push({ role: 'user', content: ex.user })
    messages.push({ role: 'assistant', content: JSON.stringify(ex.assistant) })
  }
  messages.push({
    role: 'user',
    content: buildAmbientPrompt(input.nearbyRunCount),
  })
  const result = await llm.replyAsCharacter(messages, { temperature: TEMP })
  return {
    say: stripTrailingPunctuation(result.reply.say),
    reply: result.reply,
    messages,
    meta: result.meta,
  }
}

/** ホームのambientは末尾に句読点を付けない。LLM側の指示が無視された場合の保険として末尾の。、.,を剥がす。 */
function stripTrailingPunctuation(say: string): string {
  return say.replace(/[。、.,]+\s*$/u, '')
}

function buildAmbientPrompt(count: number): string {
  const base =
    '[内部] ユーザがホーム画面をひらいた。今いる場所について、自分の中の感想や好奇心を短い1文(15字前後)でつぶやけ。「〜かな」「〜だろう」のような自問のかたちは使ってよい(ただしユーザへの直接の問いかけはしない)。小学生で習う漢字までは使ってよい。文末に句読点(。や、)は付けない。'
  if (count === 0) {
    return `${base} ぼくの観測ログにはこの場所のRunがまだない。観察より、好奇心や期待感を優先する。「ここは、どんな場所かな」「はじめての場所だ」「ここはまだ知らない」「始まりの地」「これから何が見つかるんだろう」のようなニュアンスで、毎回ちがう言いまわしを選ぶ。`
  }
  if (count <= 3) {
    return `${base} ぼくの観測ログでは、この場所で走ったことが${count}回ある。「またここだね」「ここ、覚えてる」「前にも来た所だ」「あの時の場所だ」のようなニュアンスで、毎回ちがう言いまわしを選ぶ。`
  }
  return `${base} ぼくの観測ログでは、この場所で走ったことが${count}回もある、なじみの場所。「いつもの場所」「安心する」「ここはよく知ってる」「もうおなじみの所」のようなニュアンスで、毎回ちがう言いまわしを選ぶ。`
}
