import { useEffect } from 'react'
import { subscribeAuth } from '../firebase/auth'
import { ensureUserDoc } from '../firebase/userCloud'

export function useEnsureUserDoc(): void {
  useEffect(() => {
    return subscribeAuth(u => {
      if (!u) return
      ensureUserDoc(u).catch(err => console.error('ensureUserDoc failed', err))
    })
  }, [])
}
