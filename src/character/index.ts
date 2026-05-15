export type { Character, CharacterId, FewShotExample } from './domain/character'
export type {
  DialogueThread,
  DialogueTurn,
  ThreadId,
  TurnId,
  TurnRef,
  TurnRole,
} from './domain/dialogue'
export type {
  EpisodicMemory,
  RelationalState,
  SemanticMemory,
} from './domain/memory'
export type {
  PaceDistribution,
  RunEvent,
  RunEventKind,
  RunSegment,
  RunSummary,
  RunTopology,
  RunTopologyShape,
} from './domain/runSummary'
export type {
  LLMCallMeta,
  LLMClient,
  LLMMessage,
  LLMOptions,
  LLMReply,
  LLMReplyResult,
  LLMReplyTopic,
  LLMRole,
  LLMTextResult,
  LLMUsage,
} from './llm/client'
export type {
  EpisodicQuery,
  MemoryStore,
  SemanticQuery,
  ThreadQuery,
} from './memory/store'
export type {
  BuildContextInput,
  BuiltContext,
  ContextBuilder,
} from './context/builder'
export type {
  PromptLogEntry,
  PromptLogId,
  PromptLogQuery,
  PromptLogStore,
} from './logs/promptLog'
export type {
  DialogueResult,
  DialogueService,
  SendInput,
} from './service/dialogueService'

export { LocalStoragePromptLogStore } from './logs/localStoragePromptLogStore'
export { IdbMemoryStore } from './memory/idbMemoryStore'
export { GeminiClient, type GeminiClientOptions } from './llm/geminiClient'
export {
  DefaultContextBuilder,
  type DefaultContextBuilderOptions,
} from './context/defaultContextBuilder'
export {
  DefaultDialogueService,
  type DefaultDialogueServiceDeps,
} from './service/defaultDialogueService'
export {
  useCharacterDialogue,
  type UseCharacterDialogueOptions,
  type UseCharacterDialogueReturn,
} from './hooks/useCharacterDialogue'

export {
  defaultPromptTemplates,
  describeBehavior,
  describeShape,
  formatDuration,
  formatPace,
  formatRunFacts,
  pct,
  REPLY_JSON_SCHEMA,
  renderRunSummary,
  renderSystemPrompt,
  SUMMARY_SYSTEM_PROMPT,
  type PromptTemplates,
  type SystemPromptInput,
} from './prompts'

export { petampCharacter, resolveCharacter } from './config'
export {
  onboardingScript,
  renderText as renderOnboardingText,
  type FinishStep,
  type InputStep,
  type OnboardingStep,
  type OnboardingStepKind,
  type TapStep,
} from './onboarding/script'
export {
  generateHomeAmbientPhrase,
  getDialogueService,
  getMemoryStore,
  getPromptLogStore,
  hasApiKey,
  resetAllCharacterMemory,
  resetOnboarding,
  resetPromptLog,
} from './wiring'
export type { HomeAmbientInput } from './ambient'
