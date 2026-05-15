import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { useRunStore } from '../store/useRunStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { loadRun } from '../db/runRepository'
import {
  activeComposer,
  activeDetector,
  activeStrategy,
  renderPhonemes,
} from '../notation'
import type { Run } from '../types'

/**
 * 環世界記譜法 (実験機能) 専用 chat ルート。
 * 既存 RunChatPage / Gemini Dialogue Service / Episodic Memory には一切依存しない。
 * Settings `experimental.notation` ON で解禁。
 *
 * 構成:
 *  - 画面上部: その Run の音素列 (NotationStrategy.encode の生出力)
 *  - 中央: petamp 発話バブル (SpeechComposer.compose の出力)
 *  - 下部: ユーザ入力欄。turn を進めるためのトリガに使う (内容は SpeechComposer に渡るが現状未使用)。
 */
export function NotationChatPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const enabled = useSettingsStore(s => s.experimental.notation)

  const { runs, loadRuns } = useRunStore()
  const [run, setRun] = useState<Run | null>(null)
  const [turns, setTurns] = useState<Array<{ role: 'petamp' | 'user'; text: string }>>([])
  const [input, setInput] = useState('')
  const composedOnceRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      navigate('/', { replace: true })
    }
  }, [enabled, navigate])

  useEffect(() => {
    if (runs.length === 0) void loadRuns()
  }, [runs.length, loadRuns])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    const inMemory = runs.find(r => r.id === id)
    if (inMemory) {
      setRun(inMemory)
      return
    }
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
  }, [id, runs, navigate])

  const phonemes = useMemo(
    () => (run ? activeStrategy.encode(run) : []),
    [run],
  )
  const phonemeText = useMemo(() => renderPhonemes(phonemes), [phonemes])

  // 開幕発話
  useEffect(() => {
    if (!run || composedOnceRef.current || phonemes.length === 0) return
    composedOnceRef.current = true
    const opener = activeComposer.compose({
      currentRun: { runId: run.id, phonemes },
      motifs: activeDetector.detect([{ runId: run.id, phonemes }]),
      turnIndex: 0,
    })
    setTurns([{ role: 'petamp', text: opener }])
  }, [run, phonemes])

  const onSend = () => {
    if (!run) return
    const text = input.trim()
    if (!text) return
    setInput('')
    const nextTurns: Array<{ role: 'petamp' | 'user'; text: string }> = [
      ...turns,
      { role: 'user', text },
    ]
    const petampTurnIndex = nextTurns.filter(t => t.role === 'petamp').length
    const reply = activeComposer.compose({
      currentRun: { runId: run.id, phonemes },
      motifs: activeDetector.detect([{ runId: run.id, phonemes }]),
      userInput: text,
      turnIndex: petampTurnIndex,
    })
    setTurns([...nextTurns, { role: 'petamp', text: reply }])
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
        <p className="notation-score-meta">音素数 {phonemes.length}</p>
      </section>

      <section className="notation-dialog">
        {turns.map((t, i) => (
          <div
            key={i}
            className={`notation-turn ${t.role === 'petamp' ? 'notation-turn-petamp' : 'notation-turn-user'}`}
          >
            <div className="notation-bubble">{t.text}</div>
          </div>
        ))}
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
          disabled={!input.trim()}
          aria-label="送信"
        >
          <Icon icon="lucide:arrow-up" width={20} height={20} />
        </button>
      </footer>
    </div>
  )
}
