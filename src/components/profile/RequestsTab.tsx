import { useState } from 'react'
import { Icon } from '@iconify/react'
import type { PublicUser } from '../../firebase/userCloud'
import type { FollowDoc } from '../../firebase/follows'
import {
  acceptFollowRequest,
  rejectFollowRequest,
} from '../../firebase/follows'

type Props = {
  userMap: Map<string, PublicUser>
  incomingPending: FollowDoc[]
  onChanged: () => void | Promise<void>
}

export function RequestsTab({ userMap, incomingPending, onChanged }: Props) {
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handle = async (fromUid: string, action: 'accept' | 'reject') => {
    setBusyUid(fromUid)
    setError(null)
    try {
      if (action === 'accept') await acceptFollowRequest(fromUid)
      else await rejectFollowRequest(fromUid)
      await onChanged()
    } catch (e) {
      console.error('request action failed', e)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyUid(null)
    }
  }

  if (incomingPending.length === 0) {
    return <div className="profile-empty">承認待ちのリクエストはありません</div>
  }

  const sorted = [...incomingPending].sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div className="profile-list">
      {sorted.map(req => {
        const u = userMap.get(req.followerUid)
        const busy = busyUid === req.followerUid
        return (
          <div key={req.followerUid} className="profile-row">
            <div className="profile-row-avatar">
              {u?.photoURL ? (
                <img src={u.photoURL} alt="" referrerPolicy="no-referrer" />
              ) : (
                <Icon icon="lucide:user" />
              )}
            </div>
            <div className="profile-row-name">{u?.displayName ?? '名無し'}</div>
            <div className="profile-row-actions">
              <button
                type="button"
                className="profile-row-btn status-accept"
                onClick={() => handle(req.followerUid, 'accept')}
                disabled={busy}
              >
                承認
              </button>
              <button
                type="button"
                className="profile-row-btn status-reject"
                onClick={() => handle(req.followerUid, 'reject')}
                disabled={busy}
              >
                拒否
              </button>
            </div>
          </div>
        )
      })}
      {error ? <div className="profile-screen-error">{error}</div> : null}
    </div>
  )
}
