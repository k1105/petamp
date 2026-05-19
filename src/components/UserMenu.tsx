import { useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { useAuth } from '../hooks/useAuth'
import { signInWithGoogle, signOutUser } from '../firebase/auth'

export function UserMenu() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const formatError = (e: unknown): string => {
    if (e instanceof Error) return `${e.name}: ${e.message}`
    if (typeof e === 'object' && e !== null) {
      const obj = e as { code?: string; message?: string }
      if (obj.code || obj.message) return `${obj.code ?? 'error'}: ${obj.message ?? ''}`
      try { return JSON.stringify(e) } catch { return String(e) }
    }
    return String(e)
  }

  const handleSignIn = async () => {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
      setOpen(false)
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
      setOpen(false)
    } catch (e) {
      console.error('signOut failed', e)
      setError(formatError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={rootRef} className="user-menu">
      <button
        type="button"
        className="user-menu-trigger"
        onClick={() => setOpen(v => !v)}
        aria-label={user ? 'ユーザーメニュー' : 'ログインメニュー'}
      >
        {user?.photoURL ? (
          <img src={user.photoURL} alt="" className="user-menu-avatar" referrerPolicy="no-referrer" />
        ) : (
          <Icon icon="lucide:user" />
        )}
      </button>
      {open && (
        <div className="user-menu-dropdown" role="menu">
          {user ? (
            <>
              <div className="user-menu-info">
                <div className="user-menu-name">{user.displayName ?? 'ゲスト'}</div>
                {user.email ? <div className="user-menu-email">{user.email}</div> : null}
              </div>
              <button
                type="button"
                className="user-menu-item"
                onClick={handleSignOut}
                disabled={busy}
                role="menuitem"
              >
                ログアウト
              </button>
            </>
          ) : (
            <button
              type="button"
              className="user-menu-item"
              onClick={handleSignIn}
              disabled={busy}
              role="menuitem"
            >
              Google でログイン
            </button>
          )}
          {error ? <div className="user-menu-error">{error}</div> : null}
        </div>
      )}
    </div>
  )
}
