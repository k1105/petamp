import { generateHomeAmbient, type HomeAmbientInput } from './ambient'
import { petampCharacter } from './config'
import { DefaultContextBuilder } from './context/defaultContextBuilder'
import { GeminiClient } from './llm/geminiClient'
import { IdbMemoryStore } from './memory/idbMemoryStore'
import { LocalStoragePromptLogStore } from './logs/localStoragePromptLogStore'
import { DefaultDialogueService } from './service/defaultDialogueService'
import { resolveCharacter } from './config'
import type { LLMClient } from './llm/client'
import type { MemoryStore } from './memory/store'
import type { PromptLogEntry, PromptLogStore } from './logs/promptLog'
import type { DialogueService } from './service/dialogueService'

const HOME_AMBIENT_THREAD_ID = '__home_ambient__'

let memoryInstance: MemoryStore | null = null
let promptLogInstance: PromptLogStore | null = null
let llmInstance: LLMClient | null = null
let serviceInstance: DialogueService | null = null

function getLlmClient(): LLMClient {
  if (llmInstance) return llmInstance
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY is not set')
  llmInstance = new GeminiClient({ apiKey })
  return llmInstance
}

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
  const memory = getMemoryStore()
  const promptLog = getPromptLogStore()
  const llm = getLlmClient()
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

/** オンボーディングを再表示するため、ユーザ名 (semantic) のみ削除。 */
export async function resetOnboarding(): Promise<void> {
  const memory = getMemoryStore()
  const rows = await memory.querySemantic({
    characterId: petampCharacter.id,
    keyPrefix: 'fact.user_name',
  })
  await Promise.all(rows.map(r => memory.deleteSemantic(r.id)))
}

/** プロンプトログのみ削除 (キャラ記憶は残す)。 */
export async function resetPromptLog(): Promise<void> {
  await getPromptLogStore().clear()
}

/**
 * ホーム画面用の単発ambient発話を生成。
 * 生成・失敗ともに PromptLogStore に追記する(失敗時はerror付きエントリ)。
 */
export async function generateHomeAmbientPhrase(input: HomeAmbientInput): Promise<string> {
  const promptLog = getPromptLogStore()
  const startedAt = Date.now()
  try {
    const result = await generateHomeAmbient(getLlmClient(), input)
    const entry: PromptLogEntry = {
      id: crypto.randomUUID(),
      timestamp: result.meta.startedAt,
      characterId: petampCharacter.id,
      threadId: HOME_AMBIENT_THREAD_ID,
      purpose: 'home_ambient',
      userInput: `nearbyRunCount=${input.nearbyRunCount}`,
      messages: result.messages,
      retrieval: {
        fewShotCount: petampCharacter.fewShot.length,
        recentTurnCount: 0,
        episodic: [],
        semantic: [],
      },
      reply: result.reply,
      meta: result.meta,
    }
    void promptLog.append(entry).catch(() => undefined)
    return result.say
  } catch (error) {
    const finishedAt = Date.now()
    const errMsg = error instanceof Error ? error.message : String(error)
    const errStack = error instanceof Error ? error.stack : undefined
    const entry: PromptLogEntry = {
      id: crypto.randomUUID(),
      timestamp: startedAt,
      characterId: petampCharacter.id,
      threadId: HOME_AMBIENT_THREAD_ID,
      purpose: 'home_ambient',
      userInput: `nearbyRunCount=${input.nearbyRunCount}`,
      messages: [],
      retrieval: {
        fewShotCount: petampCharacter.fewShot.length,
        recentTurnCount: 0,
        episodic: [],
        semantic: [],
      },
      meta: {
        provider: 'unknown',
        model: 'unknown',
        startedAt,
        finishedAt,
      },
      error: { message: errMsg, stack: errStack },
    }
    void promptLog.append(entry).catch(() => undefined)
    throw error
  }
}
