import { useEffect } from 'react'
import { subscribeAuth } from '../firebase/auth'
import { subscribeMyLobbies } from '../firebase/coRunCloud'
import { useCoRunStore } from '../store/useCoRunStore'

/**
 * 自分宛ての「一緒に走る」招待をどの画面にいても受け取れるよう、App() で 1 回だけ mount する
 * グローバルリスナー。auth 確定後に lobby セッションを購読し、uid 変化で張り直す。
 */
export function useCoRunInviteListener(): void {
  const setMyUid = useCoRunStore(s => s.setMyUid)
  const setIncomingInvites = useCoRunStore(s => s.setIncomingInvites)

  useEffect(() => {
    let lobbyUnsub: (() => void) | null = null
    const authUnsub = subscribeAuth(user => {
      lobbyUnsub?.()
      lobbyUnsub = null
      setMyUid(user?.uid ?? null)
      if (!user) {
        setIncomingInvites([])
        return
      }
      lobbyUnsub = subscribeMyLobbies(user.uid, setIncomingInvites)
    })
    return () => {
      authUnsub()
      lobbyUnsub?.()
    }
  }, [setMyUid, setIncomingInvites])
}
