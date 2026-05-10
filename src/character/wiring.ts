import { DefaultContextBuilder } from './context/defaultContextBuilder'
import { GeminiClient } from './llm/geminiClient'
import { IdbMemoryStore } from './memory/idbMemoryStore'
import { LocalStoragePromptLogStore } from './logs/localStoragePromptLogStore'
import { DefaultDialogueService } from './service/defaultDialogueService'
import { resolveCharacter } from './config'
import type { MemoryStore } from './memory/store'
import type { PromptLogStore } from './logs/promptLog'
import type { DialogueService } from './service/dialogueService'

let memoryInstance: MemoryStore | null = null
let promptLogInstance: PromptLogStore | null = null
let serviceInstance: DialogueService | null = null

export function getMemoryStore(): MemoryStore {
  if (!memoryInstance) memoryInstance = new IdbMemoryStore()
  return memoryInstance
}

export function getPromptLogStore(): PromptLogStore {
  if (!promptLogInstance) promptLogInstance = new LocalStoragePromptLogStore()
  return promptLogInstance
}

/**
 * Lazy初期化。VITE_GEMINI_API_KEY が無いと例外を投げる。
 * 呼び出し側はキー存在を hasApiKey() で先に確認できる。
 */
export function getDialogueService(): DialogueService {
  if (serviceInstance) return serviceInstance
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined
  if (!apiKey) {
    throw new Error('VITE_GEMINI_API_KEY is not set')
  }
  const memory = getMemoryStore()
  const promptLog = getPromptLogStore()
  const llm = new GeminiClient({ apiKey })
  const contextBuilder = new DefaultContextBuilder(memory)
  serviceInstance = new DefaultDialogueService({
    memory,
    llm,
    contextBuilder,
    promptLog,
    resolveCharacter,
  })
  return serviceInstance
}

export function hasApiKey(): boolean {
  return Boolean(import.meta.env.VITE_GEMINI_API_KEY)
}

/** キャラクターメモリとプロンプトログを全消去。 */
export async function resetAllCharacterMemory(): Promise<void> {
  await getMemoryStore().clearAll()
  await getPromptLogStore().clear()
}
