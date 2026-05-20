import { useState } from 'react'
import { Icon } from '@iconify/react'
import type { PublicUser } from '../../firebase/userCloud'
import type { FollowDoc } from '../../firebase/follows'
import {
  cancelFollowRequest,
  sendFollowRequest,
  unfollow,
} from '../../firebase/follows'

type Props = {
  myUid: string
  users: PublicUser[]
  outgoing: FollowDoc[]
  onChanged: () => void | Promise<void>
}

type RowStatus = 'none' | 'pending' | 'accepted'

function getStatus(outgoing: FollowDoc[], targetUid: string): RowStatus {
  const found = outgoing.find(f => f.followeeUid === targetUid)
  if (!found) return 'none'
  return found.status === 'accepted' ? 'accepted' : 'pending'
}

export function DiscoverTab({ myUid, users, outgoing, onChanged }: Props) {
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const others = users.filter(u => u.uid !== myUid)
  others.sort((a, b) => {
    const an = (a.displayName ?? '').toLowerCase()
    const bn = (b.displayName ?? '').toLowerCase()
    return an.localeCompare(bn)
  })

  const handleClick = async (targetUid: string, status: RowStatus) => {
    setBusyUid(targetUid)
    setError(null)
    try {
      if (status === 'none') await sendFollowRequest(targetUid)
      else if (status === 'pending') await cancelFollowRequest(targetUid)
      else if (status === 'accepted') await unfollow(targetUid)
      await onChanged()
    } catch (e) {
      console.error('follow action failed', e)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyUid(null)
    }
  }

  if (others.length === 0) {
    return <div className="profile-empty">他のユーザーはいません</div>
  }

  return (
    <div className="profile-list">
      {others.map(u => {
        const status = getStatus(outgoing, u.uid)
        const busy = busyUid === u.uid
        const label =
          status === 'accepted' ? 'フォロー中'
            : status === 'pending' ? 'リクエスト中'
            : 'フォロー'
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
              className={`profile-row-btn status-${status}`}
              onClick={() => handleClick(u.uid, status)}
              disabled={busy}
            >
              {busy ? '...' : label}
            </button>
          </div>
        )
      })}
      {error ? <div className="profile-screen-error">{error}</div> : null}
    </div>
  )
}
