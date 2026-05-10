import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { getPromptLogStore } from '../character'
import type { PromptLogEntry } from '../character'

export function PromptLogPage() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<PromptLogEntry[]>([])
  const [purposeFilter, setPurposeFilter] = useState<string>('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey(k => k + 1)

  useEffect(() => {
    let cancelled = false
    void getPromptLogStore()
      .exportAll()
      .then(es => {
        if (cancelled) return
        setEntries(es.sort((a, b) => b.timestamp - a.timestamp))
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const purposes = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) set.add(e.purpose)
    return Array.from(set).sort()
  }, [entries])

  const filtered = useMemo(() => {
    if (!purposeFilter) return entries
    return entries.filter(e => e.purpose === purposeFilter)
  }, [entries, purposeFilter])

  const onExport = () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `prompt-logs-${new Date().toISOString().slice(0, 19)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onClear = async () => {
    if (!window.confirm('すべてのプロンプトログを消去します。よろしいですか？')) return
    await getPromptLogStore().clear()
    reload()
  }

  return (
    <div className="page" style={{ background: 'var(--bg)', color: 'var(--text)', overflowY: 'auto', padding: 0 }}>
      <header className="prompt-log-header">
        <button className="back-btn" onClick={() => navigate(-1)} aria-label="戻る">
          <Icon icon="lucide:arrow-left" />
        </button>
        <h1 className="prompt-log-title">Prompt Log</h1>
      </header>

      <div className="prompt-log-controls">
        <select
          className="prompt-log-select"
          value={purposeFilter}
          onChange={e => setPurposeFilter(e.target.value)}
        >
          <option value="">すべて ({entries.length})</option>
          {purposes.map(p => (
            <option key={p} value={p}>
              {p} ({entries.filter(e => e.purpose === p).length})
            </option>
          ))}
        </select>
        <button className="btn-ghost" onClick={reload}>
          <Icon icon="lucide:rotate-ccw" />
          <span>再読込</span>
        </button>
        <button className="btn-ghost" onClick={onExport} disabled={entries.length === 0}>
          <Icon icon="lucide:download" />
          <span>JSON書出し</span>
        </button>
        <button className="btn-ghost prompt-log-clear" onClick={() => void onClear()} disabled={entries.length === 0}>
          <Icon icon="lucide:trash-2" />
          <span>全消去</span>
        </button>
      </div>

      {loading ? (
        <div className="prompt-log-empty">読み込み中…</div>
      ) : filtered.length === 0 ? (
        <div className="prompt-log-empty">ログがありません</div>
      ) : (
        <ul className="prompt-log-list">
          {filtered.map(entry => (
            <PromptLogRow
              key={entry.id}
              entry={entry}
              expanded={expandedId === entry.id}
              onToggle={() => setExpandedId(prev => (prev === entry.id ? null : entry.id))}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface RowProps {
  entry: PromptLogEntry
  expanded: boolean
  onToggle: () => void
}

function PromptLogRow({ entry, expanded, onToggle }: RowProps) {
  const date = new Date(entry.timestamp)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${hh}:${mm}:${ss}`
  const preview = entry.reply?.say ?? entry.text ?? (entry.error ? `[error] ${entry.error.message}` : '')
  const latencyMs = entry.meta.finishedAt - entry.meta.startedAt
  return (
    <li className={`prompt-log-row ${expanded ? 'expanded' : ''}`}>
      <button className="prompt-log-row-summary" onClick={onToggle}>
        <div className="prompt-log-row-line1">
          <span className="prompt-log-purpose">{entry.purpose}</span>
          <span className="prompt-log-time">{dateStr}</span>
          <span className="prompt-log-meta">
            {entry.meta.model} · {latencyMs}ms
            {entry.meta.usage?.inputTokens !== undefined &&
              ` · in:${entry.meta.usage.inputTokens} out:${entry.meta.usage.outputTokens ?? '?'}`}
          </span>
        </div>
        <div className="prompt-log-preview">{preview || '(empty)'}</div>
      </button>
      {expanded && (
        <div className="prompt-log-detail">
          <Field label="characterId">{entry.characterId}</Field>
          <Field label="threadId">{entry.threadId}</Field>
          {entry.turnId && <Field label="turnId">{entry.turnId}</Field>}
          {entry.userInput && <Field label="userInput">{entry.userInput}</Field>}
          {entry.reply && (
            <>
              <Field label="reply.thought">{entry.reply.thought}</Field>
              <Field label="reply.say">{entry.reply.say}</Field>
            </>
          )}
          {entry.text && <Field label="text">{entry.text}</Field>}
          {entry.error && (
            <Field label="error">
              <div>{entry.error.message}</div>
              {entry.error.stack && <pre className="prompt-log-stack">{entry.error.stack}</pre>}
            </Field>
          )}
          <Field label="retrieval">
            <pre className="prompt-log-json">{JSON.stringify(entry.retrieval, null, 2)}</pre>
          </Field>
          <Field label={`messages (${entry.messages.length})`}>
            <pre className="prompt-log-json">{JSON.stringify(entry.messages, null, 2)}</pre>
          </Field>
          {entry.rating && (
            <Field label="rating">
              {entry.rating.liked ? '👍' : '👎'}
              {entry.rating.note && ` · ${entry.rating.note}`}
            </Field>
          )}
        </div>
      )}
    </li>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prompt-log-field">
      <div className="prompt-log-field-label">{label}</div>
      <div className="prompt-log-field-value">{children}</div>
    </div>
  )
}
