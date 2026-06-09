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
import { useCurrentPosition } from '../hooks/useCurrentPosition'
import { useReverseGeocode } from '../hooks/useReverseGeocode'
import { useTransitionStore } from '../store/useTransitionStore'

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
  // 最終ステップで eyes をタップした時の遷移状態。fade-out クラスを当てる
  // ためのフラグ。
  const [starting, setStarting] = useState(false)

  // 走り出し演出 (expanding → iris → ...) で使う area name。
  // onboarding マウント時から GPS と reverse-geocode を kick しておくと、
  // 最終ステップに到達するころには間に合うことが多い。
  const currentPos = useCurrentPosition()
  const areaName = useReverseGeocode(currentPos?.[0] ?? null, currentPos?.[1] ?? null)

  const step: OnboardingStep = onboardingScript[stepIdx]
  const isLast = stepIdx === onboardingScript.length - 1
  const text = useMemo(() => renderOnboardingText(step.text, name), [step.text, name])

  // input step に来たら少し遅延して autofocus。吹き出しを読む間 (= 入場
  // アニメーション中) にキーボードが立ち上がらないように待つ。完全に外すと
  // 確定ボタン周りで iOS が tap を取りこぼすケースがあったため、autofocus
  // の経路自体は残す。
  const inputRef = useRef<HTMLInputElement>(null)
  const eyesRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (step.kind !== 'input') return
    const t = setTimeout(() => inputRef.current?.focus(), 800)
    return () => clearTimeout(t)
  }, [step.kind, stepIdx])

  const advance = () => {
    if (isLast) {
      navigate('/', { replace: true })
      return
    }
    setStepIdx(i => i + 1)
  }

  // 最終ステップ: eyes タップで通常のラン開始 transition に合流する。
  // 1) 画面要素を fade-out (starting フラグで CSS を切替え)
  // 2) startRecord(eyesの中心, areaName) で expanding → iris → ... を起動
  // 3) TransitionOverlay 側が iris 段階で /record に navigate する
  const startRecordFromEyes = () => {
    if (starting) return
    setStarting(true)
    const el = eyesRef.current
    const origin = el
      ? (() => {
          const r = el.getBoundingClientRect()
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        })()
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    useTransitionStore.getState().startRecord(origin, areaName, null, { fromOnboarding: true })
  }

  // 最終ステップ: ランを開始せずに Gallery へ直行する。「いまはスキップ」用。
  const skipToGallery = () => {
    if (starting) return
    navigate('/', { replace: true })
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

  const isFinish = step.kind === 'finish'

  return (
    <div
      className={`onboarding-page${starting ? ' onboarding-starting' : ''}`}
      onClick={onPageTap}
    >
      <div
        ref={eyesRef}
        className={`onboarding-eyes${isFinish ? ' onboarding-eyes-tappable' : ''}`}
        onClick={isFinish ? (e) => {
          e.stopPropagation()
          startRecordFromEyes()
        } : undefined}
        role={isFinish ? 'button' : undefined}
        aria-label={isFinish ? '最初のランをはじめる' : undefined}
      >
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
      {/* finish ステップ: eyes タップでランを開始。確定ボタンは出さないが、
          まだ走らないユーザ向けに「いまはスキップ」リンクを置く。 */}
      {isFinish && (
        <button
          type="button"
          className="onboarding-skip"
          onClick={e => {
            e.stopPropagation()
            skipToGallery()
          }}
        >
          いまはスキップ
        </button>
      )}
    </div>
  )
}
