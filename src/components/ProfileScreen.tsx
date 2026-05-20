import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { useAuth } from '../hooks/useAuth'
import { signInWithGoogle, signOutUser } from '../firebase/auth'
import { listAllUsers, type PublicUser } from '../firebase/userCloud'
import {
  listMyIncoming,
  listMyOutgoing,
  type FollowDoc,
} from '../firebase/follows'
import { DiscoverTab } from './profile/DiscoverTab'
import { RequestsTab } from './profile/RequestsTab'

type Props = {
  onClose: () => void
}

type TabKey = 'profile' | 'discover' | 'requests'

function formatError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`
  if (typeof e === 'object' && e !== null) {
    const obj = e as { code?: string; message?: string }
    if (obj.code || obj.message) return `${obj.code ?? 'error'}: ${obj.message ?? ''}`
    try { return JSON.stringify(e) } catch { return String(e) }
  }
  return String(e)
}

export function ProfileScreen({ onClose }: Props) {
  const { user } = useAuth()
  const [tab, setTab] = useState<TabKey>('profile')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [users, setUsers] = useState<PublicUser[] | null>(null)
  const [outgoing, setOutgoing] = useState<FollowDoc[]>([])
  const [incoming, setIncoming] = useState<FollowDoc[]>([])
  const [dataError, setDataError] = useState<string | null>(null)

  const uid = user?.uid
  const refresh = useCallback(async () => {
    if (!uid) return
    try {
      const [u, out, inc] = await Promise.all([
        listAllUsers(),
        listMyOutgoing(),
        listMyIncoming(),
      ])
      setUsers(u)
      setOutgoing(out)
      setIncoming(inc)
      setDataError(null)
    } catch (e) {
      console.error('profile data load failed', e)
      setDataError(formatError(e))
    }
  }, [uid])

  useEffect(() => {
    if (!uid) return
    let cancelled = false
    void (async () => {
      try {
        const [u, out, inc] = await Promise.all([
          listAllUsers(),
          listMyOutgoing(),
          listMyIncoming(),
        ])
        if (cancelled) return
        setUsers(u)
        setOutgoing(out)
        setIncoming(inc)
        setDataError(null)
      } catch (e) {
        if (cancelled) return
        console.error('profile data load failed', e)
        setDataError(formatError(e))
      }
    })()
    return () => { cancelled = true }
  }, [uid])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const userMap = useMemo(() => {
    const m = new Map<string, PublicUser>()
    for (const u of users ?? []) m.set(u.uid, u)
    return m
  }, [users])

  const incomingPending = useMemo(
    () => incoming.filter(f => f.status === 'pending'),
    [incoming],
  )

  const followingCount = useMemo(
    () => outgoing.filter(f => f.status === 'accepted').length,
    [outgoing],
  )

  const followersCount = useMemo(
    () => incoming.filter(f => f.status === 'accepted').length,
    [incoming],
  )

  const handleSignIn = async () => {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (e) {
      console.error('signIn failed', e)
      setError(formatError(e))
    } finally {
      setBusy(false)
    }
  }

  const handleSignOut = async () => {
    setBusy(true)
    setError(null)
    try {
      await signOutUser()
      onClose()
    } catch (e) {
      console.error('signOut failed', e)
      setError(formatError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="profile-screen-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="プロフィール"
      onClick={onClose}
    >
      <div className="profile-screen-card" onClick={e => e.stopPropagation()}>
        <button
          type="button"
          className="profile-screen-close"
          onClick={onClose}
          aria-label="閉じる"
        >
          <Icon icon="lucide:x" />
        </button>

        {user ? (
          <>
            <div className="profile-screen-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'profile'}
                className={`profile-screen-tab${tab === 'profile' ? ' is-active' : ''}`}
                onClick={() => setTab('profile')}
              >
                プロフィール
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'discover'}
                className={`profile-screen-tab${tab === 'discover' ? ' is-active' : ''}`}
                onClick={() => setTab('discover')}
              >
                探す
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'requests'}
                className={`profile-screen-tab${tab === 'requests' ? ' is-active' : ''}`}
                onClick={() => setTab('requests')}
              >
                リクエスト
                {incomingPending.length > 0 && (
                  <span className="profile-screen-tab-badge">{incomingPending.length}</span>
                )}
              </button>
            </div>

            <div className="profile-screen-body">
              {tab === 'profile' && (
                <div className="profile-tab-self">
                  <div className="profile-screen-avatar">
                    {user.photoURL ? (
                      <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />
                    ) : (
                      <Icon icon="lucide:user" />
                    )}
                  </div>
                  <div className="profile-screen-name">{user.displayName ?? 'ゲスト'}</div>
                  <div className="profile-screen-stats">
                    <div className="profile-screen-stat">
                      <span className="profile-screen-stat-value">{followingCount}</span>
                      <span className="profile-screen-stat-label">フォロー</span>
                    </div>
                    <div className="profile-screen-stat">
                      <span className="profile-screen-stat-value">{followersCount}</span>
                      <span className="profile-screen-stat-label">フォロワー</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="profile-screen-action"
                    onClick={handleSignOut}
                    disabled={busy}
                  >
                    ログアウト
                  </button>
                </div>
              )}

              {tab === 'discover' && (
                users === null ? (
                  <div className="profile-empty">読み込み中…</div>
                ) : (
                  <DiscoverTab
                    myUid={user.uid}
                    users={users}
                    outgoing={outgoing}
                    onChanged={refresh}
                  />
                )
              )}

              {tab === 'requests' && (
                users === null ? (
                  <div className="profile-empty">読み込み中…</div>
                ) : (
                  <RequestsTab
                    userMap={userMap}
                    incomingPending={incomingPending}
                    onChanged={refresh}
                  />
                )
              )}

              {dataError ? <div className="profile-screen-error">{dataError}</div> : null}
              {error ? <div className="profile-screen-error">{error}</div> : null}
            </div>
          </>
        ) : (
          <div className="profile-tab-self">
            <div className="profile-screen-avatar">
              <Icon icon="lucide:user" />
            </div>
            <div className="profile-screen-name">ゲスト</div>
            <div className="profile-screen-stats">
              <div className="profile-screen-stat">
                <span className="profile-screen-stat-value">0</span>
                <span className="profile-screen-stat-label">フォロー</span>
              </div>
              <div className="profile-screen-stat">
                <span className="profile-screen-stat-value">0</span>
                <span className="profile-screen-stat-label">フォロワー</span>
              </div>
            </div>
            <button
              type="button"
              className="profile-screen-action is-primary"
              onClick={handleSignIn}
              disabled={busy}
            >
              Google でログイン
            </button>
            {error ? <div className="profile-screen-error">{error}</div> : null}
          </div>
        )}
      </div>
    </div>
  )
}
