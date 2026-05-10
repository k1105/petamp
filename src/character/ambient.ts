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
    say: result.reply.say,
    reply: result.reply,
    messages,
    meta: result.meta,
  }
}

function buildAmbientPrompt(count: number): string {
  const base =
    '[内部] ユーザがホーム画面をひらいた。今いる場所について、自分の中の感想を短い1文(15字前後)でつぶやけ。問いかけや疑問形は使わない。小学生で習う漢字までは使ってよい。'
  if (count === 0) {
    return `${base} ぼくの観測ログにはこの場所のRunがまだない。「はじめての場所だ」「ここはまだ知らない」のようなニュアンスで。`
  }
  if (count <= 3) {
    return `${base} ぼくの観測ログでは、この場所で走ったことが${count}回ある。「またここだね」「ここ、覚えてる」のようなニュアンスで。`
  }
  return `${base} ぼくの観測ログでは、この場所で走ったことが${count}回もある、なじみの場所。「いつもの場所」「安心する」のようなニュアンスで。`
}
