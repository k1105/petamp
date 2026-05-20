import { useEffect } from 'react'
import { subscribeAuth } from '../firebase/auth'
import { ensureUserDoc } from '../firebase/userCloud'
import { useSocialFeedStore } from '../store/useSocialFeedStore'

export function useEnsureUserDoc(): void {
  useEffect(() => {
    return subscribeAuth(u => {
      if (!u) {
        useSocialFeedStore.getState().reset()
        return
      }
      ensureUserDoc(u).catch(err => console.error('ensureUserDoc failed', err))
      void useSocialFeedStore.getState().refresh()
    })
  }, [])
}
