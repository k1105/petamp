import type { RunSummary } from '../domain/runSummary'
import { renderSystemPrompt, type SystemPromptInput } from './systemPrompt'
import { renderRunSummary } from './runSummaryTemplate'
import { SUMMARY_SYSTEM_PROMPT, formatRunFacts } from './summaryPrompt'
import { REPLY_JSON_SCHEMA } from './replySchema'

/**
 * プロンプト一式 (system prompt, run summary 表現, 要約 prompt, JSON schema) を
 * バンドルした注入可能テンプレート。
 *
 * ContextBuilder / DialogueService / LLMClient はこれを受け取って動作する。
 * 既定値は `defaultPromptTemplates` (version='v1')。実験用に上書きすれば
 * 本体を触らずに挙動を切り替えられる。
 */
export interface PromptTemplates {
  version: string
  renderSystemPrompt: (input: SystemPromptInput) => string
  renderRunSummary: (s: RunSummary) => string
  summaryPrompt: string
  formatRunFacts: (s: RunSummary) => string
  replyJsonSchema: object
}

export const defaultPromptTemplates: PromptTemplates = {
  version: 'v1',
  renderSystemPrompt,
  renderRunSummary,
  summaryPrompt: SUMMARY_SYSTEM_PROMPT,
  formatRunFacts,
  replyJsonSchema: REPLY_JSON_SCHEMA,
}
