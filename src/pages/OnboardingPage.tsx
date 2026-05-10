import { useEffect, useMemo, useRef, useState } from 'react'
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
        {text}
      </div>

      {step.kind === 'tap' && (
        <div className="onboarding-hint">タップで つづく</div>
      )}

      {step.kind === 'input' && (
        <div className="onboarding-input-area" onClick={e => e.stopPropagation()}>
          <input
            ref={inputRef}
            className="onboarding-input"
            type="text"
            value={draftName}
            onChange={e => setDraftName(e.target.value.slice(0, step.maxLength))}
            placeholder={step.placeholder}
            onKeyDown={e => {
              if (e.key === 'Enter') void onConfirmInput(step)
            }}
          />
          <button
            className="onboarding-btn"
            disabled={!draftName.trim() || busy}
            onClick={() => void onConfirmInput(step)}
          >
            {step.confirmLabel}
          </button>
        </div>
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
