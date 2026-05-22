import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import { useAuth } from '../hooks/useAuth'
import { signInWithGoogle, signOutUser } from '../firebase/auth'
import { getUserDoc, type PublicUser } from '../firebase/userCloud'
import { listMyFriends } from '../firebase/friends'
import { useSocialFeedStore } from '../store/useSocialFeedStore'
import { InviteTab } from './profile/InviteTab'
import { FriendsTab } from './profile/FriendsTab'

type Props = {
  onClose: () => void
}

type TabKey = 'profile' | 'friends' | 'invite'

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

  const [friends, setFriends] = useState<PublicUser[] | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)

  const uid = user?.uid
  const refresh = useCallback(async () => {
    if (!uid) return
    try {
      const docs = await listMyFriends()
      const otherUids = docs.map(f => (f.members[0] === uid ? f.members[1] : f.members[0]))
      const profiles = await Promise.all(otherUids.map(u => getUserDoc(u)))
      setFriends(profiles.filter((u): u is PublicUser => !!u))
      setDataError(null)
      // フレンドが変わるとフィードに出るランも増減するので feed も更新
      void useSocialFeedStore.getState().refresh()
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
        const docs = await listMyFriends()
        if (cancelled) return
        const otherUids = docs.map(f => (f.members[0] === uid ? f.members[1] : f.members[0]))
        const profiles = await Promise.all(otherUids.map(u => getUserDoc(u)))
        if (cancelled) return
        setFriends(profiles.filter((u): u is PublicUser => !!u))
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

  const friendsCount = friends?.length ?? 0

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
                aria-selected={tab === 'friends'}
                className={`profile-screen-tab${tab === 'friends' ? ' is-active' : ''}`}
                onClick={() => setTab('friends')}
              >
                友達
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'invite'}
                className={`profile-screen-tab${tab === 'invite' ? ' is-active' : ''}`}
                onClick={() => setTab('invite')}
              >
                招待
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
                      <span className="profile-screen-stat-value">{friendsCount}</span>
                      <span className="profile-screen-stat-label">友達</span>
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

              {tab === 'friends' && (
                friends === null ? (
                  <div className="profile-empty">読み込み中…</div>
                ) : (
                  <FriendsTab friends={friends} onChanged={refresh} />
                )
              )}

              {tab === 'invite' && <InviteTab myUid={user.uid} />}

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
                <span className="profile-screen-stat-label">友達</span>
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
