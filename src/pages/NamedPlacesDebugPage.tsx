import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { getMemoryStore, petampCharacter } from '../character'
import type { NamedPlace } from '../character'

type Filter = 'all' | 'current' | 'refined'

export function NamedPlacesDebugPage() {
  const navigate = useNavigate()
  const [places, setPlaces] = useState<NamedPlace[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey(k => k + 1)

  useEffect(() => {
    let cancelled = false
    void getMemoryStore()
      .queryNamedPlaces({ characterId: petampCharacter.id })
      .then(rows => {
        if (cancelled) return
        setPlaces(rows.sort((a, b) => b.createdAt - a.createdAt))
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  // chain 末端でない id = 既に他 place の previousId に載っている = refined 済み
  const refinedIds = useMemo(() => {
    const set = new Set<string>()
    for (const p of places) {
      if (p.previousId) set.add(p.previousId)
    }
    return set
  }, [places])

  const filtered = useMemo(() => {
    if (filter === 'all') return places
    if (filter === 'current') return places.filter(p => !refinedIds.has(p.id))
    return places.filter(p => refinedIds.has(p.id))
  }, [places, filter, refinedIds])

  const onExport = () => {
    const blob = new Blob([JSON.stringify(places, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `named-places-${new Date().toISOString().slice(0, 19)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const counts = useMemo(
    () => ({
      all: places.length,
      current: places.filter(p => !refinedIds.has(p.id)).length,
      refined: places.filter(p => refinedIds.has(p.id)).length,
    }),
    [places, refinedIds],
  )

  return (
    <div className="page" style={{ background: 'var(--bg)', color: 'var(--text)', overflowY: 'auto', overscrollBehavior: 'contain', padding: 0 }}>
      <header className="prompt-log-header">
        <button className="back-btn" onClick={() => navigate(-1)} aria-label="戻る">
          <Icon icon="lucide:arrow-left" />
        </button>
        <h1 className="prompt-log-title">Named Places</h1>
      </header>

      <div className="prompt-log-controls">
        <select
          className="prompt-log-select"
          value={filter}
          onChange={e => setFilter(e.target.value as Filter)}
        >
          <option value="all">すべて ({counts.all})</option>
          <option value="current">current のみ ({counts.current})</option>
          <option value="refined">refine 済み ({counts.refined})</option>
        </select>
        <button className="btn-ghost" onClick={reload}>
          <Icon icon="lucide:rotate-ccw" />
          <span>再読込</span>
        </button>
        <button className="btn-ghost" onClick={onExport} disabled={places.length === 0}>
          <Icon icon="lucide:download" />
          <span>JSON書出し</span>
        </button>
      </div>

      {loading ? (
        <div className="prompt-log-empty">読み込み中…</div>
      ) : filtered.length === 0 ? (
        <div className="prompt-log-empty">該当する NamedPlace がありません</div>
      ) : (
        <ul className="prompt-log-list">
          {filtered.map(place => (
            <NamedPlaceRow
              key={place.id}
              place={place}
              isRefined={refinedIds.has(place.id)}
              expanded={expandedId === place.id}
              onToggle={() => setExpandedId(prev => (prev === place.id ? null : place.id))}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface RowProps {
  place: NamedPlace
  isRefined: boolean
  expanded: boolean
  onToggle: () => void
}

function NamedPlaceRow({ place, isRefined, expanded, onToggle }: RowProps) {
  const date = new Date(place.createdAt)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  const dateStr = `${mm}/${dd} ${hh}:${mi}`
  const targetKind = place.point ? 'point' : place.polyline ? 'polyline' : '?'
  const status = isRefined ? 'refined' : place.previousId ? 'refine先' : 'current'
  return (
    <li className={`prompt-log-row ${expanded ? 'expanded' : ''}`}>
      <button className="prompt-log-row-summary" onClick={onToggle}>
        <div className="prompt-log-row-line1">
          <span className="prompt-log-purpose">{place.name}</span>
          <span className="prompt-log-shortid">id:{place.id.slice(0, 8)}</span>
          <span className="prompt-log-time">{dateStr}</span>
          <span className="prompt-log-meta">
            {targetKind} · {status}
          </span>
        </div>
        <div className="prompt-log-preview">{place.description || '(no description)'}</div>
      </button>
      {expanded && (
        <div className="prompt-log-detail">
          <Field label="id">{place.id}</Field>
          <Field label="name">{place.name}</Field>
          <Field label="description">{place.description || '(empty)'}</Field>
          <Field label="sourceRunId">{place.sourceRunId}</Field>
          <Field label="sourceThreadId">{place.sourceThreadId}</Field>
          {place.previousId && <Field label="previousId">{place.previousId}</Field>}
          {place.sourcePointIdx !== undefined && (
            <Field label="sourcePointIdx">{String(place.sourcePointIdx)}</Field>
          )}
          {place.sourceSegmentIndex !== undefined && (
            <Field label="sourceSegmentIndex">{String(place.sourceSegmentIndex)}</Field>
          )}
          {place.point && (
            <Field label="point">
              {place.point.lat.toFixed(6)}, {place.point.lng.toFixed(6)}
            </Field>
          )}
          {place.polyline && (
            <Field label={`polyline (${place.polyline.length} pts)`}>
              <pre className="prompt-log-json">{JSON.stringify(place.polyline, null, 2)}</pre>
            </Field>
          )}
          <Field label="createdAt">{new Date(place.createdAt).toISOString()}</Field>
          {place.updatedAt !== place.createdAt && (
            <Field label="updatedAt">{new Date(place.updatedAt).toISOString()}</Field>
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
