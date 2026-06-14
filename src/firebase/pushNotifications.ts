import { Capacitor } from '@capacitor/core'
import { FirebaseMessaging } from '@capacitor-firebase/messaging'
import { getUid } from './auth'
import { setDocument } from './firestoreAdapter'
import { pathUserFcmToken } from './paths'

/**
 * users/{uid}/fcmTokens/{token} に保存するデバイストークン。
 * doc ID = トークン文字列なので、同一端末の再登録は自然に upsert になる。
 * 送信側 (api/notify-run) は firebase-admin で読み、無効トークンを削除する。
 */
export interface FcmTokenDoc {
  token: string
  platform: string
  updatedAt: number
}

let tokenListenerRegistered = false

async function saveToken(token: string): Promise<void> {
  const uid = await getUid()
  if (!uid) return
  await setDocument<FcmTokenDoc>(pathUserFcmToken(uid, token), {
    token,
    platform: Capacitor.getPlatform(),
    updatedAt: Date.now(),
  })
}

/**
 * サインイン後に呼ぶ。通知権限を要求し、FCM トークンを Firestore に登録する。
 * 権限が拒否されたら何もしない (再起動時に再試行される)。
 */
export async function registerPushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  const { receive } = await FirebaseMessaging.requestPermissions()
  if (receive !== 'granted') return
  if (!tokenListenerRegistered) {
    tokenListenerRegistered = true
    // FCM トークンはローテーションするので、更新されたら都度保存し直す
    void FirebaseMessaging.addListener('tokenReceived', e => {
      void saveToken(e.token).catch(err => console.warn('fcm token save failed', err))
    })
  }
  const { token } = await FirebaseMessaging.getToken()
  await saveToken(token)
}
