import { useEffect, useRef, useState } from 'react'
import { ModalPopup } from '../ui/ModalPopup'
import { useCoRunStore } from '../../store/useCoRunStore'
import { useTransitionStore } from '../../store/useTransitionStore'
import { listMyFriends } from '../../firebase/friends'
import { getUserDoc, type PublicUser } from '../../firebase/userCloud'

/**
 * 「一緒に走る」ロビー。
 * - session が無く pickerOpen → フレンド選択ビュー (host)。
 * - session が lobby → 準備状況の待機ビュー (host / 参加者共通)。
 * - session.status==='running' → 開始ゲート: startRecord を 1 回呼んで iris 遷移へ。
 * - session.status==='cancelled' → ローカルを片付けて閉じる。
 */
export function CoRunLobby() {
  const pickerOpen = useCoRunStore(s => s.pickerOpen)
  const session = useCoRunStore(s => s.session)
  const myUid = useCoRunStore(s => s.myUid)
  const createSession = useCoRunStore(s => s.createSession)
  const clearLocal = useCoRunStore(s => s.clearLocal)
  const closePicker = useCoRunStore(s => s.closePicker)

  const inLobby = !!session && session.status === 'lobby'
  const open = pickerOpen || inLobby

  // ---- 開始ゲート / キャンセルの監視 ----
  const firedStartRef = useRef(false)
  useEffect(() => {
    if (!session) return
    if (session.status === 'running' && !firedStartRef.current) {
      firedStartRef.current = true
      const origin = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      const areaName = document.querySelector('.area-label')?.textContent ?? null
      useTransitionStore.getState().startRecord(origin, areaName, session.id)
      closePicker()
    }
    if (session.status === 'cancelled') {
      clearLocal()
    }
  }, [session, closePicker, clearLocal])

  if (!open) return null
  if (inLobby) return <WaitingView />
  return <PickerView onCreate={createSession} onClose={closePicker} myUid={myUid} />
}

// ----------------------------------------------------------------------------

function PickerView({
  onCreate,
  onClose,
  myUid,
}: {
  onCreate: (members: { uid: string; displayName: string | null }[]) => Promise<void>
  onClose: () => void
  myUid: string | null
}) {
  const [friends, setFriends] = useState<PublicUser[] | null>(null)
  const [me, setMe] = useState<PublicUser | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!myUid) return
    let cancelled = false
    void (async () => {
      try {
        const [docs, mine] = await Promise.all([listMyFriends(), getUserDoc(myUid)])
        if (cancelled) return
        const otherUids = docs.map(f => (f.members[0] === myUid ? f.members[1] : f.members[0]))
        const profiles = await Promise.all(otherUids.map(u => getUserDoc(u)))
        if (cancelled) return
        setFriends(profiles.filter((u): u is PublicUser => !!u))
        setMe(mine)
      } catch (e) {
        if (cancelled) return
        console.error('co-run friend load failed', e)
        setError('フレンドの読み込みに失敗しました')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [myUid])

  const toggle = (uid: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  const handleStart = async () => {
    if (!myUid || selected.size === 0) return
    setCreating(true)
    setError(null)
    try {
      const picked = (friends ?? []).filter(f => selected.has(f.uid))
      const members = [
        { uid: myUid, displayName: me?.displayName ?? null },
        ...picked.map(f => ({ uid: f.uid, displayName: f.displayName })),
      ]
      await onCreate(members)
    } catch (e) {
      console.error('co-run create failed', e)
      setError('セッションの作成に失敗しました')
      setCreating(false)
    }
  }

  return (
    <ModalPopup title="一緒に走る相手を選ぶ" onClose={onClose}>
      <div className="co-run-picker">
        {error && <p className="co-run-error">{error}</p>}
        {friends === null ? (
          <p className="co-run-hint">読み込み中…</p>
        ) : friends.length === 0 ? (
          <p className="co-run-hint">フレンドがいません。先にフレンドを追加してください。</p>
        ) : (
          <ul className="co-run-friend-list">
            {friends.map(f => (
              <li key={f.uid}>
                <label className="co-run-friend-row">
                  <input
                    type="checkbox"
                    checked={selected.has(f.uid)}
                    onChange={() => toggle(f.uid)}
                  />
                  <span className="co-run-member-name">{f.displayName || '匿名ランナー'}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="co-run-btn co-run-btn-primary co-run-btn-block"
          disabled={selected.size === 0 || creating}
          onClick={() => void handleStart()}
        >
          {creating ? '作成中…' : `このメンバーで誘う（${selected.size}人）`}
        </button>
      </div>
    </ModalPopup>
  )
}

// ----------------------------------------------------------------------------

const STATE_LABEL: Record<string, string> = {
  ready: '準備OK',
  invited: '招待中',
  declined: '辞退',
  left: '退出',
  running: '走行中',
  finished: 'ゴール',
}

function WaitingView() {
  const session = useCoRunStore(s => s.session)
  const myUid = useCoRunStore(s => s.myUid)
  const leave = useCoRunStore(s => s.leave)
  const [expired, setExpired] = useState(() => !!session && session.expiresAt <= Date.now())

  useEffect(() => {
    if (!session) return
    const remain = session.expiresAt - Date.now()
    if (remain <= 0) return
    const t = window.setTimeout(() => setExpired(true), remain)
    return () => window.clearTimeout(t)
  }, [session])

  if (!session) return null
  const isHost = session.hostUid === myUid

  return (
    <ModalPopup title="一緒に走る" onClose={() => void leave()}>
      <div className="co-run-waiting">
        <p className="co-run-hint">
          {expired ? '時間切れです。もう一度誘い直してください。' : '全員の準備が整うと自動でスタートします。'}
        </p>
        <ul className="co-run-friend-list">
          {session.memberUids.map(uid => {
            const m = session.members[uid]
            const isMe = uid === myUid
            return (
              <li key={uid} className="co-run-member-row">
                <span className="co-run-member-name">
                  {(m?.displayName || '匿名ランナー') + (isMe ? '（あなた）' : '')}
                </span>
                <span className={`co-run-member-state co-run-state-${m?.state ?? 'invited'}`}>
                  {STATE_LABEL[m?.state ?? 'invited'] ?? m?.state}
                </span>
              </li>
            )
          })}
        </ul>
        <button
          type="button"
          className="co-run-btn co-run-btn-ghost co-run-btn-block"
          onClick={() => void leave()}
        >
          {isHost ? 'キャンセル' : '退出'}
        </button>
      </div>
    </ModalPopup>
  )
}
