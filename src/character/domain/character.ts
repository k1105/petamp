import type { LLMReply } from '../llm/client'

export type CharacterId = string

export interface FewShotExample {
  user: string
  assistant: LLMReply
}

export interface Character {
  id: CharacterId
  name: string
  /** 一人称・口調・性格・話してよい/避けたい話題などを自然文で。system promptに丸ごと入る想定。 */
  persona: string
  /** thought + say の両方を含む対話例。少数(3〜6)を想定。 */
  fewShot: FewShotExample[]
}
