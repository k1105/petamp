import { useEffect } from 'react'
import { subscribeAuth } from '../firebase/auth'
import { registerPushNotifications } from '../firebase/pushNotifications'

/** サインイン状態になったら FCM トークンを登録する (ネイティブのみ動作)。 */
export function usePushNotifications(): void {
  useEffect(() => {
    return subscribeAuth(u => {
      if (!u) return
      void registerPushNotifications().catch(err =>
        console.warn('registerPushNotifications failed', err),
      )
    })
  }, [])
}
