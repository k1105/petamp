import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { RunTile } from './RunTile'
import { CoRunTile } from './CoRunTile'
import { RunEditSheet } from './RunEditSheet'
import { IslandView } from '../island/IslandView'
import { ConfirmDialog } from '../ConfirmDialog'
import { useRunStore } from '../../store/useRunStore'
import { useSocialFeedStore } from '../../store/useSocialFeedStore'
import { computeArchipelagoLayout, type ArchipelagoLayoutResult } from '../../utils/archipelagoLayout'
import { MOVEMENT_TYPES, getMovementType } from '../../utils/movementType'
import type { MovementType, Run } from '../../types'

type RunFilter = 'all' | 'mine' | 'friends'
const RUN_FILTER_OPTIONS: { value: RunFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'mine', label: '自分の記録' },
  { value: 'friends', label: '友達の記録' },
]

type MovementFilter = MovementType | 'all'
const MOVEMENT_FILTER_OPTIONS: { value: MovementFilter; label: string }[] = [
  { value: 'all', label: 'すべての種別' },
  ...MOVEMENT_TYPES.map(m => ({ value: m.value as MovementFilter, label: m.label })),
]

// TRAIL 一覧用の表示単位。一緒に走ったラン (同一 coRunSessionId) は
// 自分 + 相手をまとめて 1 つの co-run アイテムに統合する。
type ListItem =
  | { kind: 'single'; run: Run }
  | { kind: 'corun'; sessionId: string; runs: Run[] }

/**
 * Gallery のリストパネル中身 (TRAIL / ISLAND タブ)。
 * フィルタ状態と archipelago layout キャッシュはこのパネルに閉じる
 * (タブ切替で IslandView が unmount しても、このコンポーネントは
 * gallery-panel 内に mount されたまま残るのでキャッシュが生きる)。
 */
export function GalleryListPanel({
  onSelectRun,
}: {
  onSelectRun: (runId: string) => void
}) {
  const { runs, updateRun, removeRun } = useRunStore()
  const followedRuns = useSocialFeedStore(s => s.followedRuns)
  const followedUsers = useSocialFeedStore(s => s.followedUsers)

  const [listMode, setListMode] = useState<'trail' | 'island'>('trail')
  // 一覧の表示フィルター。すべて / 自分のみ / 友達のみ を切り替える。
  const [runFilter, setRunFilter] = useState<RunFilter>('all')
  // 移動種別フィルター。'all' なら全種別。
  const [movementFilter, setMovementFilter] = useState<MovementFilter>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  // 長押しで開く編集シート対象のラン id。自分のランのみ (RunTile が他人のランでは発火しない)。
  const [editingRunId, setEditingRunId] = useState<string | null>(null)

  // TRAIL / ISLAND タブにはフォロー中ユーザーのランも混ぜて表示する。
  // マップ・dot アニメ・home phrase・STATS は今まで通り自分のランのみ。
  const socialRuns = useMemo(() => {
    const base =
      runFilter === 'mine'
        ? runs
        : runFilter === 'friends'
          ? followedRuns
          : [...runs, ...followedRuns]
    const filtered =
      movementFilter === 'all'
        ? base
        : base.filter(r => getMovementType(r) === movementFilter)
    return filtered.slice().sort((a, b) => b.startedAt - a.startedAt)
  }, [runs, followedRuns, runFilter, movementFilter])

  const ownerByUid = useMemo(() => {
    const m = new Map<string, typeof followedUsers[number]>()
    for (const u of followedUsers) m.set(u.uid, u)
    return m
  }, [followedUsers])

  const listItems = useMemo<ListItem[]>(() => {
    const items: ListItem[] = []
    const seenSessions = new Set<string>()
    for (const run of socialRuns) {
      const sid = run.coRunSessionId
      if (sid) {
        if (seenSessions.has(sid)) continue
        seenSessions.add(sid)
        items.push({
          kind: 'corun',
          sessionId: sid,
          runs: socialRuns.filter(r => r.coRunSessionId === sid),
        })
      } else {
        items.push({ kind: 'single', run })
      }
    }
    return items
  }, [socialRuns])

  // TRAIL 一覧は移動種別ごとにグルーピングして見出しを付ける。
  // co-run は代表ラン (先頭) の種別で分類する。MOVEMENT_TYPES の順で並べ、空グループは省く。
  const listGroups = useMemo(() => {
    const typeOf = (item: ListItem) =>
      getMovementType(item.kind === 'single' ? item.run : item.runs[0])
    return MOVEMENT_TYPES.map(meta => ({
      meta,
      items: listItems.filter(item => typeOf(item) === meta.value),
    })).filter(g => g.items.length > 0)
  }, [listItems])

  // ISLAND タブの archipelago layout はタブを開くたびに再計算すると重いので、
  // パネル側に持ち上げて socialRuns 参照単位でキャッシュする。ISLAND タブが
  // 初めて開かれたタイミングで非同期 (1 フレーム後) に計算してローディングを
  // 描画してから走らせる。
  const [archLayout, setArchLayout] = useState<ArchipelagoLayoutResult | null>(null)
  const [archLoading, setArchLoading] = useState(false)
  const archLayoutRunsRef = useRef<Run[] | null>(null)
  // 計算中フラグは ref で持つ。state にすると依存に入れた effect が自身を
  // キャンセルして二度と rAF が走らなくなる。
  const archInFlightRef = useRef(false)

  // socialRuns 参照が変わったら layout を破棄。
  useEffect(() => {
    if (archLayoutRunsRef.current !== null && archLayoutRunsRef.current !== socialRuns) {
      archLayoutRunsRef.current = null
      // socialRuns 入れ替えで前回キャッシュを破棄するための同期 reset。
      setArchLayout(null)
    }
  }, [socialRuns])

  useEffect(() => {
    if (listMode !== 'island') return
    if (archLayoutRunsRef.current === socialRuns) return
    if (archInFlightRef.current) return
    if (socialRuns.length === 0) return
    archInFlightRef.current = true
    // rAF 計算前にローディング UI を確実に描画させるための同期セット。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setArchLoading(true)
    const target = socialRuns
    // rAF で 1 フレーム譲ってローディング UI を確実に描画してから計算。
    const raf = requestAnimationFrame(() => {
      const result = computeArchipelagoLayout(target)
      archLayoutRunsRef.current = target
      archInFlightRef.current = false
      setArchLayout(result)
      setArchLoading(false)
    })
    return () => {
      cancelAnimationFrame(raf)
      archInFlightRef.current = false
    }
  }, [listMode, socialRuns])

  const editingRun = editingRunId ? runs.find(r => r.id === editingRunId) ?? null : null
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  return (
    <>
      <div className="list-mode-header">
        <div className="list-mode-toggle" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={listMode === 'trail'}
            className={`list-mode-toggle-btn${listMode === 'trail' ? ' is-active' : ''}`}
            onClick={() => setListMode('trail')}
          >
            TRAIL
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={listMode === 'island'}
            className={`list-mode-toggle-btn${listMode === 'island' ? ' is-active' : ''}`}
            onClick={() => setListMode('island')}
          >
            ISLAND
          </button>
        </div>
        <div className="list-filter">
          <button
            type="button"
            className={`list-filter-btn${runFilter !== 'all' || movementFilter !== 'all' ? ' is-active' : ''}`}
            aria-label="記録のフィルター"
            aria-haspopup="true"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen(o => !o)}
          >
            <Icon icon="lucide:filter" />
          </button>
          {filterOpen && (
            <>
              <div
                className="list-filter-backdrop"
                onClick={() => setFilterOpen(false)}
              />
              <div className="list-filter-menu" role="menu">
                <p className="list-filter-section">表示</p>
                {RUN_FILTER_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={runFilter === opt.value}
                    className={`list-filter-item${runFilter === opt.value ? ' is-active' : ''}`}
                    onClick={() => setRunFilter(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
                <div className="list-filter-divider" role="separator" />
                <p className="list-filter-section">移動種別</p>
                {MOVEMENT_FILTER_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={movementFilter === opt.value}
                    className={`list-filter-item${movementFilter === opt.value ? ' is-active' : ''}`}
                    onClick={() => setMovementFilter(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {socialRuns.length === 0 ? (
        <p className="empty-hint">記録したランがここに表示されます</p>
      ) : listMode === 'trail' ? (
        <div className="run-groups">
          {listGroups.map(group => (
            <section key={group.meta.value} className="run-group">
              <h3 className="run-group-heading">
                <Icon icon={group.meta.icon} />
                <span>{group.meta.label}</span>
              </h3>
              <div className="run-grid">
                {group.items.map(item =>
                  item.kind === 'single' ? (
                    <RunTile
                      key={item.run.id}
                      run={item.run}
                      owner={item.run.ownerUid ? ownerByUid.get(item.run.ownerUid) ?? null : null}
                      onRequestEdit={setEditingRunId}
                      onSelect={onSelectRun}
                    />
                  ) : (
                    <CoRunTile
                      key={item.sessionId}
                      runs={item.runs}
                      ownerByUid={ownerByUid}
                      onSelect={onSelectRun}
                    />
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="island-view-wrap">
          <IslandView
            layout={archLayout}
            loading={archLoading}
            socialRuns={socialRuns}
            ownerByUid={ownerByUid}
          />
        </div>
      )}

      {editingRun && (
        <RunEditSheet
          run={editingRun}
          onChangeType={type => {
            void updateRun(editingRun.id, { movementType: type })
          }}
          onDelete={() => {
            setEditingRunId(null)
            setPendingDeleteId(editingRun.id)
          }}
          onClose={() => setEditingRunId(null)}
        />
      )}
      {pendingDeleteId && (
        <ConfirmDialog
          message="このランを削除しますか？"
          confirmLabel="削除"
          destructive
          onConfirm={() => {
            void removeRun(pendingDeleteId)
            setPendingDeleteId(null)
          }}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
    </>
  )
}
