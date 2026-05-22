import { useState } from 'react'
import { Icon } from '@iconify/react'
import type { PublicUser } from '../../firebase/userCloud'
import { removeFriend } from '../../firebase/friends'

type Props = {
  friends: PublicUser[]
  onChanged: () => void | Promise<void>
}

export function FriendsTab({ friends, onChanged }: Props) {
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleRemove = async (targetUid: string) => {
    if (!window.confirm('この友達を解除しますか？')) return
    setBusyUid(targetUid)
    setError(null)
    try {
      await removeFriend(targetUid)
      await onChanged()
    } catch (e) {
      console.error('removeFriend failed', e)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyUid(null)
    }
  }

  if (friends.length === 0) {
    return (
      <div className="profile-empty">
        まだ友達がいません。<br />「招待」タブから招待してみましょう。
      </div>
    )
  }

  const sorted = [...friends].sort((a, b) => {
    const an = (a.displayName ?? '').toLowerCase()
    const bn = (b.displayName ?? '').toLowerCase()
    return an.localeCompare(bn)
  })

  return (
    <div className="profile-list">
      {sorted.map(u => {
        const busy = busyUid === u.uid
        return (
          <div key={u.uid} className="profile-row">
            <div className="profile-row-avatar">
              {u.photoURL ? (
                <img src={u.photoURL} alt="" referrerPolicy="no-referrer" />
              ) : (
                <Icon icon="lucide:user" />
              )}
            </div>
            <div className="profile-row-name">{u.displayName ?? '名無し'}</div>
            <button
              type="button"
              className="profile-row-btn status-reject"
              onClick={() => handleRemove(u.uid)}
              disabled={busy}
            >
              {busy ? '...' : '解除'}
            </button>
          </div>
        )
      })}
      {error ? <div className="profile-screen-error">{error}</div> : null}
    </div>
  )
}
