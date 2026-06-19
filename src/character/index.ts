export type { FewShotExample } from './domain/character'
export type {
  DialogueTurn,
  ThreadId,
} from './domain/dialogue'
export type {
  EpisodicMemory,
  NamedPlace,
  RelationalState,
  SemanticMemory,
} from './domain/memory'
export type {
  RunSegment,
  RunSummary,
} from './domain/runSummary'
export type {
  LLMMessage,
  LLMReply,
  LLMReplyTopic,
} from './llm/client'
export type {
  PersistNameProposalResult,
  PromptLogEntry,
} from './logs/promptLog'

export { GeminiClient } from './llm/geminiClient'
export { useCharacterDialogue } from './hooks/useCharacterDialogue'
export { petampCharacter } from './config'
export {
  onboardingScript,
  renderText as renderOnboardingText,
  type InputStep,
  type OnboardingStep,
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
  setMemoryStoreFactory,
} from './wiring'
