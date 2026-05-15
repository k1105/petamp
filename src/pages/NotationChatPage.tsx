import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { useRunStore } from '../store/useRunStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { loadRun } from '../db/runRepository'
import { buildRunSummary } from '../utils/runSummary'
import {
  getDialogueService,
  getMemoryStore,
  hasApiKey,
  petampCharacter,
  useCharacterDialogue,
} from '../character'
import type { DialogueTurn, RunSummary } from '../character'
import {
  activeDetector,
  activeStrategy,
  buildNotationSystemNote,
  renderPhonemes,
} from '../notation'
import type { Run } from '../types'

/**
 * 環世界記譜法 (実験機能) — Run単位の対話画面。
 *
 * アーキテクチャ (2026-05-15 ymgishi 確定):
 *  - 既存の useCharacterDialogue / getDialogueService をそのまま使う
 *  - 音素列 / 検出済みモチーフは extraSystemNote として毎ターン注入
 *  - persona / Diary / Ambient / 既存 RunChatPage には触らない
 *  - Settings `experimental.notation` ON のときだけ到達可能
 */
export function NotationChatPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const enabled = useSettingsStore(s => s.experimental.notation)

  const { runs, loadRuns } = useRunStore()
  const [run, setRun] = useState<Run | null>(null)
  const [runsLoaded, setRunsLoaded] = useState(false)
  const [input, setInput] = useState('')
  const openedRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      navigate('/', { replace: true })
    }
  }, [enabled, navigate])

  useEffect(() => {
    let cancelled = false
    if (runs.length > 0) {
      Promise.resolve().then(() => {
        if (!cancelled) setRunsLoaded(true)
      })
    } else {
      loadRuns().finally(() => {
        if (!cancelled) setRunsLoaded(true)
      })
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    const inMemory = runs.find(r => r.id === id)
    if (inMemory) {
      setRun(inMemory)
      return () => {
        cancelled = true
      }
    }
    if (!runsLoaded) return
    void loadRun(id).then(r => {
      if (cancelled) return
      if (!r) {
        navigate('/', { replace: true })
        return
      }
      setRun(r)
    })
    return () => {
      cancelled = true
    }
  }, [id, runs, runsLoaded, navigate])

  const apiOk = hasApiKey()
  const service = useMemo(() => (apiOk ? getDialogueService() : null), [apiOk])
  const memory = useMemo(() => getMemoryStore(), [])

  const runSummary = useMemo<RunSummary | undefined>(
    () => (run ? buildRunSummary(run) : undefined),
    [run],
  )
  const refs = useMemo(
    () => (run ? [{ kind: 'run' as const, id: run.id }] : undefined),
    [run],
  )

  // 譜面 + モチーフ表示用 (毎ターン system prompt にも入る)
  const phonemes = useMemo(
    () => (run ? activeStrategy.encode(run) : []),
    [run],
  )
  const phonemeText = useMemo(() => renderPhonemes(phonemes), [phonemes])
  const motifs = useMemo(() => {
    if (!run) return []
    const all = runs.map(r => ({
      runId: r.id,
      phonemes: r.id === run.id ? phonemes : activeStrategy.encode(r),
    }))
    return activeDetector.detect(all)
  }, [run, runs, phonemes])

  const extraSystemNote = useMemo(() => {
    if (!run) return undefined
    return buildNotationSystemNote(run, runs)
  }, [run, runs])

  const dialogue = useCharacterDialogue({
    characterId: petampCharacter.id,
    service: service!,
    memory,
    defaultRunSummary: runSummary,
    defaultRefs: refs,
  })

  // 開幕発話 (1回だけ)。hidden trigger 風に音素オープナーを投げて、petamp に最初の発話を作らせる。
  useEffect(() => {
    if (!service || !run || openedRef.current) return
    if (phonemes.length === 0) return
    openedRef.current = true
    void dialogue.send(
      'はじめまして。ぼくのことばで、このランのこと、おしえて。',
      { extraSystemNote },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, run, phonemes.length])

  const onSend = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    void dialogue.send(text, { extraSystemNote })
  }

  if (!apiOk) {
    return (
      <div className="page" style={{ padding: 24, color: 'var(--text)' }}>
        <p>VITE_GEMINI_API_KEY が設定されていません。</p>
        <button className="btn-ghost" onClick={() => navigate(-1)}>戻る</button>
      </div>
    )
  }

  if (!run) {
    return <div className="page loading">読み込み中...</div>
  }

  return (
    <div className="notation-page">
      <header className="notation-header">
        <button
          className="notation-back-btn"
          onClick={() => navigate(`/run/${run.id}`)}
          aria-label="戻る"
        >
          <Icon icon="lucide:arrow-left" width={18} height={18} />
        </button>
        <span className="notation-header-title">ぼくのことば</span>
        <span className="notation-header-strategy">{activeStrategy.id}</span>
      </header>

      <section className="notation-score">
        <h3 className="notation-score-label">譜面</h3>
        <p className="notation-score-text">{phonemeText || '(音素なし)'}</p>
        <p className="notation-score-meta">
          音素数 {phonemes.length} / モチーフ {motifs.length}
        </p>
        {motifs.length > 0 && (
          <ul className="notation-score-motifs">
            {motifs.slice(0, 5).map(m => (
              <li key={m.id}>
                <span className="notation-score-motif-id">{m.id}</span>
                <span className="notation-score-motif-count">×{m.instances.length}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="notation-dialog">
        {dialogue.messages.map(t => (
          <NotationTurnView key={t.id} turn={t} />
        ))}
        {dialogue.isThinking && (
          <div className="notation-thinking">ペタンプが考え中…</div>
        )}
        {dialogue.error && (
          <div className="notation-error">エラー: {dialogue.error.message}</div>
        )}
      </section>

      <footer className="notation-input-area">
        <textarea
          className="notation-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onSend()
            }
          }}
          rows={1}
          placeholder="話しかける… (cmd+Enter で送信)"
        />
        <button
          className="notation-send-btn"
          onClick={onSend}
          disabled={!input.trim() || dialogue.isThinking}
          aria-label="送信"
        >
          <Icon icon="lucide:arrow-up" width={20} height={20} />
        </button>
      </footer>
    </div>
  )
}

const HIDDEN_OPENING = 'はじめまして。ぼくのことばで、このランのこと、おしえて。'

function NotationTurnView({ turn }: { turn: DialogueTurn }) {
  if (turn.role === 'user' && turn.content === HIDDEN_OPENING) {
    return null
  }
  return (
    <div
      className={`notation-turn ${turn.role === 'character' ? 'notation-turn-petamp' : 'notation-turn-user'}`}
    >
      <div className="notation-bubble">{turn.content}</div>
    </div>
  )
}
