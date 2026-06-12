import { useEffect, useMemo, useState } from 'react'
import { acceptedPoints } from '../utils/geo/recordingFilters'
import { memberColor } from '../utils/run/coRunColors'
import { useRunStore } from '../store/useRunStore'
import { useCoRunStore } from '../store/useCoRunStore'
import { useSocialFeedStore } from '../store/useSocialFeedStore'
import { useAuth } from './useAuth'
import { cloudGetRunOf } from '../firebase/runCloud'
import type { Run } from '../types'

// 取得できないメンバー (クラウド伝播待ち等) を取りこぼさないためのリトライ。
const LOAD_RETRY_MAX = 8
const LOAD_RETRY_INTERVAL_MS = 1500

export type CoRunEntry = {
  uid: string
  run: Run
  color: [number, number, number]
  name: string
  isMe: boolean
  photoURL: string | null
}

// 合成リプレイに渡す前の生データ。色はまだ付けない (dedup と並べ替えのあとで確定する)。
type RawEntry = { uid: string; run: Run; name: string; isMe: boolean; photoURL: string | null }

/**
 * 表示用 entries を確定させる共通処理。専用画面を持たず「通常ランの描画を N 本に拡張」する
 * 方針なので、重複・並び順をここで一元的に正規化してから描画コンポーネントに渡す。
 * - run.id で重複排除 (クラウド echo などで同じランが二重に入るのを防ぐ)。
 * - 自分のランは 1 本だけに畳む (同一 coRunSessionId のローカルランが複数あっても、
 *   myRunId 一致 → 無ければ accepted points が最多のものを残す)。これが「自分が二人いる」
 *   と z-fighting の元。
 * - 自分を先頭にして色順を安定させる (ギャラリーの CoRunTile と同じ規約 = 自分が緑)。
 */
function normalizeEntries(raw: RawEntry[], myRunId: string | null): CoRunEntry[] {
  const byRun = new Map<string, RawEntry>()
  for (const r of raw) if (!byRun.has(r.run.id)) byRun.set(r.run.id, r)
  let list = [...byRun.values()]

  const selves = list.filter(r => r.isMe)
  if (selves.length > 1) {
    const keep =
      (myRunId && selves.find(s => s.run.id === myRunId)) ||
      [...selves].sort(
        (a, b) =>
          acceptedPoints(b.run.trackPoints).length - acceptedPoints(a.run.trackPoints).length,
      )[0]
    list = list.filter(r => !r.isMe || r.run.id === keep.run.id)
  }

  list.sort((a, b) => (a.isMe ? 0 : 1) - (b.isMe ? 0 : 1))
  return list.map((r, i): CoRunEntry => ({
    uid: r.uid,
    run: r.run,
    color: memberColor(i),
    name: r.name,
    isMe: r.isMe,
    photoURL: r.photoURL,
  }))
}

/**
 * 同一 coRunSessionId のラン (自分 + 相手) を集めて合成リプレイ用の entries に正規化する。
 * 旧 CoRunResultPage の取得ロジックを共通フックに移し、RunDetailPage が N 本描画に使う。
 *
 * - `live=true` (ラン終了直後フロー) では参加者のランをクラウドから読み (伝播遅延はリトライ)。
 * - `live=false` (一覧から過去 co-run を開いた場合) は保存済みランから再構成する。
 */
export function useCoRunReplay(
  sessionId: string | null | undefined,
  opts: { live: boolean; myRunId: string | null },
): CoRunEntry[] | null {
  const { live, myRunId } = opts

  const session = useCoRunStore(s => s.session)
  const myUid = useCoRunStore(s => s.myUid)
  const localRuns = useRunStore(s => s.runs)
  const followedRuns = useSocialFeedStore(s => s.followedRuns)
  const followedUsers = useSocialFeedStore(s => s.followedUsers)
  const { user: currentUser } = useAuth()

  // ライブセッション (ラン直後フロー) か。一覧から過去の co-run を開いた場合は null。
  const liveSession = live && session && session.id === sessionId ? session : null

  const [liveEntries, setLiveEntries] = useState<CoRunEntry[] | null>(null)

  // 過去の co-run (ライブセッション無し) を、保存済みランから再構成する。
  // 自分のランはローカル、相手のランはソーシャルフィード (フレンドのラン) から、
  // 同じ coRunSessionId で集める。
  const storedEntries = useMemo<CoRunEntry[] | null>(() => {
    if (liveSession || !sessionId) return null
    const mine: RawEntry[] = localRuns
      .filter(r => r.coRunSessionId === sessionId)
      .map(r => ({
        uid: myUid ?? r.id,
        run: r,
        isMe: true,
        name: 'あなた',
        photoURL: currentUser?.photoURL ?? null,
      }))
    const others: RawEntry[] = followedRuns
      .filter(r => r.coRunSessionId === sessionId)
      .map(r => {
        const uid = r.ownerUid ?? r.id
        const followed = followedUsers.find(u => u.uid === uid)
        const fromParticipants = r.coRunParticipants?.find(p => p.uid === uid)?.displayName
        return {
          uid,
          run: r,
          isMe: false,
          name: followed?.displayName || fromParticipants || '匿名ランナー',
          photoURL: followed?.photoURL ?? null,
        }
      })
    const combined = [...mine, ...others]
    if (combined.length === 0) return null
    return normalizeEntries(combined, myRunId)
  }, [liveSession, localRuns, followedRuns, followedUsers, sessionId, myUid, myRunId, currentUser])

  // フォロー情報が未ロードのまま過去 co-run を開いた場合は取り込みを促す。
  useEffect(() => {
    if (liveSession || storedEntries) return
    void useSocialFeedStore.getState().refresh()
  }, [liveSession, storedEntries])

  // ライブセッション: 参加者全員のランを読み込む (自分はローカル、他参加者はクラウド)。
  // クラウド伝播の遅延で取りこぼしたメンバーはリトライして埋める (相手の軌跡が出ない問題対策)。
  useEffect(() => {
    if (!liveSession) return
    let cancelled = false
    let timer = 0
    let attempt = 0
    const load = async () => {
      const active = liveSession.memberUids.filter(uid => {
        const m = liveSession.members[uid]
        return !!m && !!m.runId && m.state === 'finished'
      })
      const loaded = await Promise.all(
        active.map(async (uid): Promise<RawEntry | null> => {
          const runId = liveSession.members[uid].runId!
          try {
            const run =
              uid === myUid
                ? localRuns.find(r => r.id === runId) ?? (await cloudGetRunOf(uid, runId))
                : await cloudGetRunOf(uid, runId)
            if (!run) return null
            const isMe = uid === myUid
            return {
              uid,
              run,
              isMe,
              name: liveSession.members[uid].displayName || '匿名ランナー',
              photoURL: isMe
                ? currentUser?.photoURL ?? null
                : followedUsers.find(u => u.uid === uid)?.photoURL ?? null,
            }
          } catch (e) {
            console.warn('co-run member run load failed', uid, e)
            return null
          }
        }),
      )
      if (cancelled) return
      const ok = loaded.filter((e): e is RawEntry => !!e)
      setLiveEntries(normalizeEntries(ok, myRunId))
      // 全員ぶん揃っていなければ伝播待ちとみなしてリトライ。
      if (ok.length < active.length && attempt < LOAD_RETRY_MAX) {
        attempt++
        timer = window.setTimeout(() => void load(), LOAD_RETRY_INTERVAL_MS)
      }
    }
    void load()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [liveSession, myUid, localRuns, followedUsers, currentUser, myRunId])

  return liveSession ? liveEntries : storedEntries
}
