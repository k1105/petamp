import { useState } from 'react'
import { Icon } from '@iconify/react'
import { useAuth } from '../hooks/useAuth'
import { ProfileScreen } from './ProfileScreen'

export function UserMenu() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="user-menu-trigger"
        onClick={() => setOpen(true)}
        aria-label="プロフィールを開く"
      >
        {user?.photoURL ? (
          <img src={user.photoURL} alt="" className="user-menu-avatar" referrerPolicy="no-referrer" />
        ) : (
          <Icon icon="lucide:user" />
        )}
      </button>
      {open && <ProfileScreen onClose={() => setOpen(false)} />}
    </>
  )
}
