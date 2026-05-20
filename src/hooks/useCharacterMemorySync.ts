import { useEffect, useRef } from 'react'
import { getMemoryStore, petampCharacter } from '../character'
import { CompositeMemoryStore } from '../firebase/compositeMemoryStore'
import { syncCharacterMemoryOnAuth } from '../firebase/characterSync'
import { useAuth } from './useAuth'

/**
 * ログイン状態の変化に追従してキャラ記憶を Firestore と同期する。
 * - ログイン後に1回 pull (Firestore → IDB)
 * - 初回マイグレーション (IDB → Firestore) を併走
 * - サインアウト時は何もしない (ローカルはそのまま、再ログイン時に同期し直す)
 */
export function useCharacterMemorySync(): void {
  const { user, loading } = useAuth()
  const syncedUidRef = useRef<string | null>(null)

  useEffect(() => {
    if (loading) return
    if (!user) {
      syncedUidRef.current = null
      return
    }
    if (syncedUidRef.current === user.uid) return
    syncedUidRef.current = user.uid

    const store = getMemoryStore()
    if (!(store instanceof CompositeMemoryStore)) return

    void syncCharacterMemoryOnAuth(store, petampCharacter.id)
  }, [user, loading])
}
