import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { useRunStore } from '../store/useRunStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { loadRun } from '../db/runRepository'
import { buildRunSummary } from '../utils/runSummary'
import { acceptedPoints } from '../utils/recordingFilters'
import {
  CLOSING_NOTE,
  NOTATION_OPENING_TRIGGER_FRESH,
  NOTATION_OPENING_TRIGGER_RESUME,
  isHiddenTriggerContent,
} from '../utils/runChatPrompts'
import {
  getDialogueService,
  getMemoryStore,
  hasApiKey,
  petampCharacter,
  useCharacterDialogue,
} from '../character'
import type {
  DialogueTurn,
  EpisodicMemory,
  RelationalState,
  RunSummary,
} from '../character'
import {
  activeDetector,
  activeStrategy,
  buildNotationSystemNote,
  renderPhonemes,
} from '../notation'
import { useAuth } from '../hooks/useAuth'
import { ReportSheet } from '../components/report/ReportSheet'
import type { Run } from '../types'

const MAX_PETAMP_TURNS = 5

/**
 * 環世界記譜法 (実験機能) — Run単位の対話画面。
 *
 * アーキテクチャ (2026-05-15 ymgishi 確定):
 *  - 既存の useCharacterDialogue / getDialogueService を再利用
 *  - 音素列 / 検出済みモチーフは extraSystemNote として毎ターン注入
 *  - persona / Diary / Ambient / 既存 RunChatPage には触らない
 *  - Settings `experimental.notation` ON でのみ到達可能
 *  - RunChatPage 同様 5 ラリーで終了、CLOSING_NOTE で締めの発話を誘導、episodic memory に永続化
 */
export function NotationChatPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const enabled = useSettingsStore(s => s.experimental.notation)

  const { runs, loadRuns } = useRunStore()
  const [run, setRun] = useState<Run | null>(null)
  const [runsLoaded, setRunsLoaded] = useState(false)
  const [input, setInput] = useState('')
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [newEpisodic, setNewEpisodic] = useState<EpisodicMemory | null>(null)
  const [endingDismissed, setEndingDismissed] = useState(false)
  const { user } = useAuth()
  const relationalSnapshotRef = useRef<RelationalState | null>(null)
  const discardedRef = useRef(false)
  const closedRef = useRef(false)
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
      // store に既にあれば追加 IO 無しで即セット。
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
  const runPoints = useMemo(
    () => (run ? acceptedPoints(run.trackPoints) : undefined),
    [run],
  )

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
    defaultRunPoints: runPoints,
    defaultRefs: refs,
  })

  // 開幕発話: 既存 episodic memory の有無で FRESH / RESUME を切替
  useEffect(() => {
    if (!service || !run || openedRef.current) return
    if (phonemes.length === 0) return
    openedRef.current = true
    void memory.getRelational(petampCharacter.id).then(snapshot => {
      relationalSnapshotRef.current = snapshot ?? null
    })
    void memory
      .queryEpisodic({
        characterId: petampCharacter.id,
        relatedTo: [{ kind: 'run', id: run.id }],
      })
      .then(episodic => {
        const opener = episodic.length > 0
          ? NOTATION_OPENING_TRIGGER_RESUME
          : NOTATION_OPENING_TRIGGER_FRESH
        void dialogue.send(opener, { extraSystemNote })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, run, phonemes.length])

  // セッション破棄/離脱時にスレッドを closeThread (RunChatPage と同じ流儀)
  const threadIdRef = useRef(dialogue.threadId)
  useEffect(() => {
    threadIdRef.current = dialogue.threadId
  }, [dialogue.threadId])
  const runSummaryRef = useRef(runSummary)
  useEffect(() => {
    runSummaryRef.current = runSummary
  }, [runSummary])
  useEffect(() => {
    return () => {
      if (discardedRef.current || closedRef.current) return
      const tid = threadIdRef.current
      if (service && tid) void service.closeThread(tid, runSummaryRef.current)
    }
  }, [service])

  const petampTurnCount = useMemo(
    () => dialogue.messages.filter(t => t.role === 'character').length,
    [dialogue.messages],
  )
  const sessionEnded = petampTurnCount >= MAX_PETAMP_TURNS

  useEffect(() => {
    if (!sessionEnded || closedRef.current) return
    if (!service) return
    closedRef.current = true
    void dialogue.close().then(res => {
      if (res) setNewEpisodic(res.episodic)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEnded, service])

  const onSend = () => {
    if (sessionEnded) return
    const text = input.trim()
    if (!text) return
    setInput('')
    const isClosingTurn = petampTurnCount === MAX_PETAMP_TURNS - 1
    const closingNote = isClosingTurn ? CLOSING_NOTE : undefined
    const merged = closingNote && extraSystemNote
      ? `${extraSystemNote}\n\n${closingNote}`
      : (extraSystemNote ?? closingNote)
    void dialogue.send(text, { extraSystemNote: merged })
  }

  const goBack = () => {
    if (!run) return
    navigate(`/run/${run.id}`)
  }

  const onCloseTap = () => {
    if (petampTurnCount === 0 || sessionEnded) {
      goBack()
      return
    }
    setConfirmDiscardOpen(true)
  }

  const onConfirmDiscard = async () => {
    setConfirmDiscardOpen(false)
    const tid = threadIdRef.current
    if (service && tid) {
      discardedRef.current = true
      await service.discardThread(tid, relationalSnapshotRef.current)
    }
    goBack()
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

  const showChatUi = !sessionEnded || !endingDismissed

  return (
    <div className="notation-page">
      {showChatUi && (
        <>
          <header className="notation-header">
            <button
              className="notation-back-btn"
              onClick={onCloseTap}
              aria-label="閉じる"
            >
              <Icon icon="lucide:x" width={18} height={18} />
            </button>
            <span className="notation-header-title">ぼくのことば</span>
            <span className="notation-header-progress" aria-label={`残り発話 ${MAX_PETAMP_TURNS - petampTurnCount}`}>
              {Array.from({ length: MAX_PETAMP_TURNS }).map((_, i) => (
                <span
                  key={i}
                  className={`notation-progress-dot ${i < petampTurnCount ? 'filled' : ''}`}
                />
              ))}
            </span>
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

          {!sessionEnded ? (
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
          ) : (
            <footer className="notation-finish-area">
              {user && (
                <button
                  className="notation-report-btn"
                  onClick={() => setReportOpen(true)}
                >
                  報告する
                </button>
              )}
              <button
                className="notation-ending-btn"
                onClick={() => setEndingDismissed(true)}
              >
                おわる
              </button>
            </footer>
          )}
        </>
      )}

      {user && reportOpen && (
        <ReportSheet
          onClose={() => setReportOpen(false)}
          uid={user.uid}
          characterId={petampCharacter.id}
          threadId={dialogue.threadId}
          turns={dialogue.messages}
          locationPath={location.pathname}
        />
      )}

      {sessionEnded && endingDismissed && (
        <div className="notation-ending">
          {newEpisodic ? (
            <div className="notation-ending-summary">{newEpisodic.summary}</div>
          ) : (
            <div className="notation-ending-summary notation-ending-loading">
              きょうのこと、おぼえてるね…
            </div>
          )}
          <button
            className="notation-ending-btn"
            onClick={goBack}
            disabled={!newEpisodic}
          >
            おわる
          </button>
        </div>
      )}

      {confirmDiscardOpen && (
        <div className="notation-modal-backdrop" role="dialog" aria-modal="true">
          <div className="notation-modal">
            <p className="notation-modal-text">中断しますか？ここまでの会話は破棄されます。</p>
            <div className="notation-modal-actions">
              <button
                className="notation-modal-btn notation-modal-btn-cancel"
                onClick={() => setConfirmDiscardOpen(false)}
              >
                キャンセル
              </button>
              <button
                className="notation-modal-btn notation-modal-btn-confirm"
                onClick={() => void onConfirmDiscard()}
              >
                破棄して戻る
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function NotationTurnView({ turn }: { turn: DialogueTurn }) {
  if (turn.role === 'user' && isHiddenTriggerContent(turn.content)) {
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
