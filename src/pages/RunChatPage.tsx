import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { EyesIcon } from '../components/gallery/EyesIcon'
import { useRunStore } from '../store/useRunStore'
import { loadRun } from '../db/runRepository'
import { buildRunSummary } from '../utils/runSummary'
import { buildRunSvgPath, RUN_SVG_VIEW_SIZE } from '../utils/runSvgPath'
import {
  getDialogueService,
  getMemoryStore,
  hasApiKey,
  petampCharacter,
  useCharacterDialogue,
} from '../character'
import type { DialogueTurn, EpisodicMemory, RelationalState, ThreadId } from '../character'
import type { Run } from '../types'

const HIDDEN_PREFIX = '[internal]'
const OPENING_TRIGGER_FRESH = `${HIDDEN_PREFIX} ユーザがこのRunの詳細画面にひらいた。runSummaryから気になる点をひとつだけ取り上げ、ユーザに短く問いかけて会話を始めよ。`
const OPENING_TRIGGER_RESUME = `${HIDDEN_PREFIX} ユーザがこのRunの詳細画面にひらいた。これは初対面ではない。前にこの "まさにこのRun" について話したことがあるはず([このRunについて、前に話したこと]節を参照)。前回触れた話題やユーザの反応を踏まえ、続きから自然に再開する短い一言を返せ。新しい観察として始めない。「まえ別のところで」のような他Runとの混同表現は厳禁。`
const CLOSING_NOTE = 'これがこのセッションのペタンプ最後の発話。ユーザの直前の発言に短く触れたあと、今日話せたことについての一言の感想で会話を締めくくれ。問いかけで終わらせず、感謝や満足のことばで結ぶこと。'
const MAX_PETAMP_TURNS = 5

function isHidden(turn: DialogueTurn): boolean {
  return turn.role === 'user' && turn.content.startsWith(HIDDEN_PREFIX)
}

function formatLog(turns: DialogueTurn[]): string {
  return turns
    .map(t => {
      const label =
        t.role === 'user'
          ? t.content.startsWith(HIDDEN_PREFIX)
            ? '[内部トリガ]'
            : 'ユーザ'
          : 'ペタンプ'
      const body = t.content.startsWith(HIDDEN_PREFIX)
        ? t.content.slice(HIDDEN_PREFIX.length).trim()
        : t.content
      return `${label}: ${body}`
    })
    .join('\n')
}

export function RunChatPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { runs, loadRuns } = useRunStore()
  const [run, setRun] = useState<Run | null>(null)
  const [runsLoaded, setRunsLoaded] = useState(false)
  const [input, setInput] = useState('')
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  /** このRunについて以前のsession で生成された episodic 群。 */
  const [pastEpisodic, setPastEpisodic] = useState<EpisodicMemory[]>([])
  /** session 終了時に生成された新しい episodic。 */
  const [newEpisodic, setNewEpisodic] = useState<EpisodicMemory | null>(null)
  /** session開始時の関係値スナップショット。破棄時の巻き戻し先。 */
  const relationalSnapshotRef = useRef<RelationalState | null>(null)
  const snapshotTakenRef = useRef(false)
  /** 破棄済みフラグ。trueならunmount時のcloseThreadをスキップ。 */
  const discardedRef = useRef(false)
  /** session 終了時に既に close 済みかどうか。 */
  const closedRef = useRef(false)

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
      Promise.resolve().then(() => {
        if (!cancelled) setRun(inMemory)
      })
      return () => {
        cancelled = true
      }
    }
    if (!runsLoaded) return
    loadRun(id).then(r => {
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
  const runSummary = useMemo(() => (run ? buildRunSummary(run) : undefined), [run])
  const refs = useMemo(() => (run ? [{ kind: 'run' as const, id: run.id }] : undefined), [run])
  const svgPath = useMemo(() => (run ? buildRunSvgPath(run.trackPoints) : ''), [run])

  const dialogue = useCharacterDialogue({
    characterId: petampCharacter.id,
    service: service!,
    memory,
    defaultRunSummary: runSummary,
    defaultRefs: refs,
  })

  // 初回オープニング: マウント時にスナップショット + 過去episodicを取って opener を選んで送信
  const openedRef = useRef(false)
  useEffect(() => {
    if (!service || !run || openedRef.current) return
    openedRef.current = true
    void Promise.all([
      memory.getRelational(petampCharacter.id),
      memory.queryEpisodic({
        characterId: petampCharacter.id,
        relatedTo: [{ kind: 'run', id: run.id }],
      }),
    ]).then(([snapshot, episodic]) => {
      relationalSnapshotRef.current = snapshot ?? null
      snapshotTakenRef.current = true
      setPastEpisodic(episodic)
      const opener = episodic.length > 0 ? OPENING_TRIGGER_RESUME : OPENING_TRIGGER_FRESH
      void dialogue.send(opener)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, run, memory])

  // 退出時に closeThread → episodic 化 (破棄済み/明示close済みならスキップ)
  const threadIdRef = useRef<ThreadId | null>(null)
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

  const visibleMessages = useMemo(
    () => dialogue.messages.filter(t => !isHidden(t)),
    [dialogue.messages],
  )

  const petampTurnCount = useMemo(
    () => dialogue.messages.filter(t => t.role === 'character').length,
    [dialogue.messages],
  )
  const sessionEnded = petampTurnCount >= MAX_PETAMP_TURNS

  // session 終了を検知したら自動的に close → summary 取得
  useEffect(() => {
    if (!sessionEnded || closedRef.current) return
    if (!service) return
    closedRef.current = true
    void dialogue.close().then(ep => {
      if (ep) setNewEpisodic(ep)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEnded, service])

  const onSend = () => {
    if (sessionEnded) return
    const text = input.trim()
    if (!text) return
    setInput('')
    // 次の応答が最後 (5回目) になるなら締めの指示を添える
    const isClosingTurn = petampTurnCount === MAX_PETAMP_TURNS - 1
    void dialogue.send(text, isClosingTurn ? { extraSystemNote: CLOSING_NOTE } : undefined)
  }

  const goBack = () => {
    navigate(`/run/${run!.id}`)
  }

  const onBackTap = () => {
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

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 1600)
  }

  const onCopy = async () => {
    const text = formatLog(dialogue.messages)
    if (!text) {
      showToast('コピーする会話がありません')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      showToast('コピーしました')
    } catch {
      showToast('コピーに失敗しました')
    }
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
    <div className="chat-page">
      <header className="chat-header">
        <button className="chat-header-icon-btn" onClick={onBackTap} aria-label="戻る">
          <Icon icon="lucide:arrow-left" width={18} height={18} />
        </button>
        <div className="chat-header-meta">
          <div className="chat-header-name">{run.name}</div>
          {dialogue.relationship && (
            <div className="chat-header-status">
              親密度 {dialogue.relationship.familiarity}/100 ・ {dialogue.relationship.totalTurns}ターン ・ ペタンプ {petampTurnCount}/{MAX_PETAMP_TURNS}
            </div>
          )}
        </div>
        <button
          className="chat-header-icon-btn"
          onClick={() => void onCopy()}
          aria-label="会話ログをコピー"
          title="会話ログをコピー"
        >
          <Icon icon="lucide:clipboard-copy" width={16} height={16} />
        </button>
      </header>

      <div className="chat-body">
        {svgPath && (
          <div className="chat-run-marker">
            <svg
              className="chat-run-marker-svg"
              viewBox={`0 0 ${RUN_SVG_VIEW_SIZE} ${RUN_SVG_VIEW_SIZE}`}
              aria-label="このRunの軌跡"
            >
              <path d={svgPath} />
            </svg>
            <div className="chat-run-marker-label">{run.name}</div>
          </div>
        )}
        {pastEpisodic.length > 0 && (
          <div className="chat-memory-card">
            <div className="chat-memory-card-title">このRunについて、ぼくが覚えていること</div>
            <ul className="chat-memory-card-list">
              {pastEpisodic.map(e => (
                <li key={e.id}>{e.summary}</li>
              ))}
            </ul>
          </div>
        )}
        {visibleMessages.map(turn => (
          <MessageRow
            key={turn.id}
            turn={turn}
            isLast={turn.id === visibleMessages.at(-1)?.id}
            promptLogId={dialogue.lastPromptLogId}
            onRate={dialogue.rate}
          />
        ))}
        {dialogue.isThinking && (
          <div className="chat-thinking">ペタンプが考え中…</div>
        )}
        {dialogue.error && (
          <div className="chat-error">エラー: {dialogue.error.message}</div>
        )}
        {sessionEnded && (
          <div className="chat-end">またね。きょうのはなし、おぼえておくね。</div>
        )}
        {sessionEnded && (
          <div className="chat-memory-card chat-memory-card-new">
            <div className="chat-memory-card-title">
              {newEpisodic ? '今日の会話を覚えました' : '今日の会話を覚えています…'}
            </div>
            {newEpisodic ? (
              <p className="chat-memory-card-summary">{newEpisodic.summary}</p>
            ) : (
              <p className="chat-memory-card-summary chat-memory-card-loading">…</p>
            )}
          </div>
        )}
      </div>

      <footer className="chat-footer">
        <textarea
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onSend()
            }
          }}
          rows={1}
          disabled={sessionEnded}
          placeholder={sessionEnded ? 'セッション終了' : 'ペタンプに話しかける… (⌘+Enter)'}
        />
        <button
          className="chat-send-btn"
          onClick={onSend}
          disabled={!input.trim() || dialogue.isThinking || sessionEnded}
        >
          送信
        </button>
      </footer>

      {toast && <div className="chat-toast">{toast}</div>}

      {confirmDiscardOpen && (
        <div className="chat-modal-backdrop" role="dialog" aria-modal="true">
          <div className="chat-modal">
            <p className="chat-modal-text">中断しますか？ここまでの会話は破棄されます。</p>
            <div className="chat-modal-actions">
              <button
                className="chat-modal-btn chat-modal-btn-cancel"
                onClick={() => setConfirmDiscardOpen(false)}
              >
                キャンセル
              </button>
              <button
                className="chat-modal-btn chat-modal-btn-confirm"
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

interface MessageRowProps {
  turn: DialogueTurn
  isLast: boolean
  promptLogId: string | null
  onRate: (id: string, liked: boolean, note?: string) => Promise<void>
}

function MessageRow({ turn, isLast, promptLogId, onRate }: MessageRowProps) {
  const isUser = turn.role === 'user'
  if (isUser) {
    return (
      <div className="chat-row chat-row-user">
        <div className="chat-bubble chat-bubble-user">{turn.content}</div>
      </div>
    )
  }
  return (
    <div className="chat-row chat-row-character">
      <div className="chat-row-character-inner">
        <div className="chat-row-eye"><EyesIcon /></div>
        <div className="chat-bubble chat-bubble-character">{turn.content}</div>
      </div>
      {isLast && promptLogId && (
        <div className="chat-rate">
          <button onClick={() => void onRate(promptLogId, true)} aria-label="good">👍</button>
          <button onClick={() => void onRate(promptLogId, false)} aria-label="bad">👎</button>
        </div>
      )}
    </div>
  )
}
