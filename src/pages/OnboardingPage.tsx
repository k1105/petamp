import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { EyesIcon } from '../components/gallery/EyesIcon'
import {
  getMemoryStore,
  onboardingScript,
  petampCharacter,
  renderOnboardingText,
  type InputStep,
  type OnboardingStep,
} from '../character'

/**
 * text 内の `\n` を <br />、`|` 区切りの各 phrase を inline-block span として
 * 描画する。inline-block で包むことで、ブラウザの行折り返しが `|` の位置で
 * しか起きず、デバイス幅に関わらず単語の途中で改行されない。
 */
function renderBubbleText(text: string): ReactNode {
  return text.split('\n').map((line, lineIdx) => (
    <Fragment key={lineIdx}>
      {lineIdx > 0 && <br />}
      {line.split('|').map((phrase, phraseIdx) =>
        phrase ? (
          <span key={phraseIdx} className="onboarding-phrase">
            {phrase}
          </span>
        ) : null,
      )}
    </Fragment>
  ))
}

/** 名前を semantic memory に保存。 */
async function saveName(key: string, name: string): Promise<void> {
  const now = Date.now()
  await getMemoryStore().putSemantic({
    id: crypto.randomUUID(),
    characterId: petampCharacter.id,
    key,
    value: name,
    confidence: 1,
    createdAt: now,
    updatedAt: now,
  })
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const [stepIdx, setStepIdx] = useState(0)
  const [name, setName] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [busy, setBusy] = useState(false)

  const step: OnboardingStep = onboardingScript[stepIdx]
  const isLast = stepIdx === onboardingScript.length - 1
  const text = useMemo(() => renderOnboardingText(step.text, name), [step.text, name])

  // input step に来たら autofocus
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (step.kind === 'input') inputRef.current?.focus()
  }, [step.kind, stepIdx])

  const advance = () => {
    if (isLast) {
      navigate('/', { replace: true })
      return
    }
    setStepIdx(i => i + 1)
  }

  const onConfirmInput = async (s: InputStep) => {
    const trimmed = draftName.trim()
    if (!trimmed || busy) return
    // iOSのキーボードを閉じてから遷移処理に入る。閉じ忘れると次stepの
    // タップが「キーボードを閉じる」操作で消費されて進まない。
    inputRef.current?.blur()
    setBusy(true)
    try {
      await saveName(s.saveAs, trimmed)
      setName(trimmed)
      setDraftName('')
      advance()
    } finally {
      setBusy(false)
    }
  }

  const onPageTap = () => {
    // input/finish ステップは専用ボタンで進める。tapステップのみ画面タップで前進。
    if (step.kind !== 'tap') return
    advance()
  }

  return (
    <div className="onboarding-page" onClick={onPageTap}>
      <div className="onboarding-eyes">
        <EyesIcon />
      </div>

      <div key={step.id} className="onboarding-bubble">
        {renderBubbleText(text)}
      </div>

      {step.kind === 'tap' && (
        <div className="onboarding-hint">タップで つづく</div>
      )}

      {step.kind === 'input' && (
        <form
          className="onboarding-input-area"
          onClick={e => e.stopPropagation()}
          onSubmit={e => {
            e.preventDefault()
            void onConfirmInput(step)
          }}
        >
          <input
            ref={inputRef}
            className="onboarding-input"
            type="text"
            value={draftName}
            onChange={e => setDraftName(e.target.value.slice(0, step.maxLength))}
            placeholder={step.placeholder}
            inputMode="text"
            enterKeyHint="done"
            autoCapitalize="off"
            autoCorrect="off"
          />
          <button
            type="submit"
            className="onboarding-btn"
            disabled={!draftName.trim() || busy}
          >
            {step.confirmLabel}
          </button>
        </form>
      )}

      {step.kind === 'finish' && (
        <div className="onboarding-input-area" onClick={e => e.stopPropagation()}>
          <button className="onboarding-btn" onClick={advance}>
            {step.confirmLabel}
          </button>
        </div>
      )}
    </div>
  )
}
