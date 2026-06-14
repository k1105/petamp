import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { useAuth } from './useAuth'
import { listRuns } from '../db/runRepository'
import { useSocialFeedStore } from '../store/useSocialFeedStore'
import { buildTraceCandidates, TraceGeofence } from '../utils/traceGeofence'

/**
 * 「過去の自分/友人の軌跡に近づいたら通知」のジオフェンス候補を
 * ネイティブへ同期する。ソーシャルフィード (フレンドのラン) が更新される
 * たびに作り直す。位置情報「常に許可」が未取得ならアップグレードを要求する
 * (iOS はダイアログを一度しか出さないので毎回呼んで問題ない)。
 */
export function useTraceGeofences(): void {
  const { user } = useAuth()
  const loaded = useSocialFeedStore(s => s.loaded)
  const followedRuns = useSocialFeedStore(s => s.followedRuns)
  const followedUsers = useSocialFeedStore(s => s.followedUsers)

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !user || !loaded) return
    let cancelled = false
    void (async () => {
      const ownRuns = await listRuns()
      if (cancelled) return
      const friendNames = new Map(followedUsers.map(u => [u.uid, u.displayName]))
      const candidates = buildTraceCandidates(ownRuns, followedRuns, friendNames)
      await TraceGeofence.setCandidates({ candidates })
      const { location } = await TraceGeofence.checkPermissions()
      if (location !== 'always' && location !== 'denied') {
        await TraceGeofence.requestAlwaysPermission()
      }
    })().catch(err => console.warn('useTraceGeofences sync failed', err))
    return () => {
      cancelled = true
    }
  }, [user, loaded, followedRuns, followedUsers])
}
