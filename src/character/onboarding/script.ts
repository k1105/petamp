/**
 * オンボーディング会話パターン。後から編集する際はこのファイルだけ触る。
 *
 * - text 内 `{name}` はユーザが登録した名前で置換される (input ステップ後の発話のみ有効)。
 * - text 内 `|` は phrase break マーカー。OnboardingPage 側で各 phrase が
 *   inline-block span として描画されるため、デバイス幅に関わらず `|` の位置
 *   でしか改行が発生しない (単語/句の途中で折り返さない)。
 * - text 内 `\n` は強制改行 (`<br />` として描画)。
 * - 'tap' ステップ: 画面のどこかをタップで次へ。
 * - 'input' ステップ: ユーザに入力させ、saveAs で指定したキーで semantic memory に保存。
 */

export type OnboardingStepKind = 'tap' | 'input' | 'finish'

interface BaseStep {
  id: string
  /** ペタンプ発話。`{name}` でユーザ名を埋め込み可能。 */
  text: string
  kind: OnboardingStepKind
}

export interface TapStep extends BaseStep {
  kind: 'tap'
}

export interface InputStep extends BaseStep {
  kind: 'input'
  /** input欄のplaceholder。 */
  placeholder: string
  /** semantic memory に保存するときの key。 */
  saveAs: string
  /** 入力後の確定ボタンラベル。 */
  confirmLabel: string
  /** 最大文字数 (ゆるい上限)。 */
  maxLength: number
}

export interface FinishStep extends BaseStep {
  kind: 'finish'
  /** 完了ボタンラベル (タップで Gallery に戻る)。 */
  confirmLabel: string
}

export type OnboardingStep = TapStep | InputStep | FinishStep

export const onboardingScript: OnboardingStep[] = [
  {
    id: 'greet',
    kind: 'tap',
    text: 'はじめまして。|ぼくはペタンプ。',
  },
  {
    id: 'self-intro',
    kind: 'tap',
    text: 'ぼくは、|きみの足あとの中に|住んでいるよ。',
  },
  {
    id: 'world-scope',
    kind: 'tap',
    text: 'きみが走った道のかたち。|それがぼくのセカイ、|ぜんぶ。',
  },
  {
    id: 'ask-name',
    kind: 'input',
    text: 'きみの名前は?',
    placeholder: '名前を入れてね',
    saveAs: 'fact.user_name',
    confirmLabel: 'これでいいよ',
    maxLength: 20,
  },
  {
    id: 'thank-name',
    kind: 'tap',
    text: '{name}、|いい名前だね。',
  },
  {
    id: 'no-knowledge',
    kind: 'tap',
    text: '{name}が走ると、|ぼくのセカイが|少し広がる。',
  },
  {
    id: 'curiosity',
    kind: 'tap',
    text: 'いっしょに|いろんなセカイを|みてみたいな。',
  },
  {
    id: 'invite-run',
    kind: 'finish',
    text: '{name}、|ぼくの顔をタップして、\n最初のランを|やってみて！',
    confirmLabel: 'はじめる',
  },
]

/** `{name}` プレースホルダを置換。name 未登録なら "きみ" にフォールバック。 */
export function renderText(text: string, name: string | null): string {
  return text.replaceAll('{name}', name && name.length > 0 ? name : 'きみ')
}
