import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers'
import { Icon } from '@iconify/react'
import { BaseMap } from '../components/map/BaseMap'
import { useMapZoom } from '../components/map/MapContext'
import { DeckOverlay } from '../components/map/DeckOverlay'
import { buildPathPositions } from '../utils/tubeMesh'
import { acceptedPoints } from '../utils/recordingFilters'
import { positionAtTime } from '../hooks/useGalleryAnimation'
import { computeRunsBbox, expandBboxByMeters } from '../utils/runBbox'
import { effectiveRadius } from '../utils/effectiveRadius'
import { REPLAY_SPEED } from '../utils/replaySpeed'
import { useSettingsStore } from '../store/useSettingsStore'
import { useRunStore } from '../store/useRunStore'
import { useCoRunStore } from '../store/useCoRunStore'
import { useSocialFeedStore } from '../store/useSocialFeedStore'
import { usePostRunLoadingStore } from '../store/usePostRunLoadingStore'
import { cloudGetRunOf } from '../firebase/runCloud'
import { memberColor } from '../utils/coRunColors'
import type { Run } from '../types'

const CURRENT_DOT_SCALE = 1.2

// 取得できないメンバー (クラウド伝播待ち等) を取りこぼさないためのリトライ。
const LOAD_RETRY_MAX = 8
const LOAD_RETRY_INTERVAL_MS = 1500

type Entry = {
  uid: string
  run: Run
  color: [number, number, number]
  name: string
}

/**
 * 一緒に走ったメンバー全員の GPS 軌跡を 1 枚の地図に重ね、絶対時刻の共通タイムラインで
 * N 本のポリライン + 動く点を同時再生する画面。
 *
 * - GPS はラン中は同期していないが、各自のランは保存済みで read 可能 (firestore.rules)。
 * - ここで初めて他参加者の軌跡 (cloudGetRunOf) を読み込み、合成再生する。
 * - 「次へ」で自分のランの結果/対話 (/run/:id/result) へ進む。
 */
export function CoRunResultPage() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const myRunId = (location.state as { myRunId?: string } | null)?.myRunId ?? null

  const session = useCoRunStore(s => s.session)
  const myUid = useCoRunStore(s => s.myUid)
  const clearLocal = useCoRunStore(s => s.clearLocal)
  const localRuns = useRunStore(s => s.runs)
  const followedRuns = useSocialFeedStore(s => s.followedRuns)
  const followedUsers = useSocialFeedStore(s => s.followedUsers)
  const startPostRunLoading = usePostRunLoadingStore(s => s.start)

  // ライブセッション (ラン直後フロー) か。一覧から過去の co-run をタップした場合は null。
  const liveSession = session && session.id === sessionId ? session : null

  // ライブセッションで読み込んだ entries。過去 co-run は storedEntries を直接使う。
  const [liveEntries, setLiveEntries] = useState<Entry[] | null>(null)
  const [playing, setPlaying] = useState(true)
  const [absMs, setAbsMs] = useState(0)

  // 過去の co-run (ライブセッション無し) を、保存済みランから再構成する。
  // 自分のランはローカル、相手のランはソーシャルフィード (フレンドのラン) から、
  // 同じ coRunSessionId で集める。
  const storedEntries = useMemo<Entry[] | null>(() => {
    if (liveSession) return null
    const mine = localRuns
      .filter(r => r.coRunSessionId === sessionId)
      .map(r => ({ uid: myUid ?? r.id, run: r, isMe: true }))
    const seen = new Set(mine.map(m => m.run.id))
    const others = followedRuns
      .filter(r => r.coRunSessionId === sessionId && !seen.has(r.id))
      .map(r => ({ uid: r.ownerUid ?? r.id, run: r, isMe: false }))
    const combined = [...mine, ...others]
    if (combined.length === 0) return null
    return combined.map((c, i): Entry => {
      const fromParticipants = c.run.coRunParticipants?.find(p => p.uid === c.uid)?.displayName
      const fromFollowed = followedUsers.find(u => u.uid === c.uid)?.displayName
      return {
        uid: c.uid,
        run: c.run,
        color: memberColor(i),
        name: c.isMe ? 'あなた' : fromFollowed || fromParticipants || '匿名ランナー',
      }
    })
  }, [liveSession, localRuns, followedRuns, followedUsers, sessionId, myUid])

  // フォロー情報が未ロードのまま過去 co-run を開いた場合は取り込みを促す。
  useEffect(() => {
    if (liveSession || storedEntries) return
    void useSocialFeedStore.getState().refresh()
  }, [liveSession, storedEntries])

  // 表示できるランが一切無い (セッション喪失かつ保存済みも無い) ときだけホームへ。
  useEffect(() => {
    if (liveSession) return
    if (storedEntries && storedEntries.length > 0) return
    // フォローのロード待ちを少し猶予してからフォールバック。
    const t = window.setTimeout(() => {
      if (myRunId) navigate(`/run/${myRunId}/result`, { replace: true })
      else navigate('/', { replace: true })
    }, 2500)
    return () => window.clearTimeout(t)
  }, [liveSession, storedEntries, myRunId, navigate])

  // 実際に描画する entries: ライブは読み込み結果、過去 co-run は保存済みから再構成。
  const entries = liveSession ? liveEntries : storedEntries

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
        active.map(async (uid, i): Promise<Entry | null> => {
          const runId = liveSession.members[uid].runId!
          try {
            const run =
              uid === myUid
                ? localRuns.find(r => r.id === runId) ?? (await cloudGetRunOf(uid, runId))
                : await cloudGetRunOf(uid, runId)
            if (!run) return null
            return {
              uid,
              run,
              color: memberColor(i),
              name: liveSession.members[uid].displayName || '匿名ランナー',
            }
          } catch (e) {
            console.warn('co-run member run load failed', uid, e)
            return null
          }
        }),
      )
      if (cancelled) return
      const ok = loaded.filter((e): e is Entry => !!e)
      setLiveEntries(ok)
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
  }, [liveSession, myUid, localRuns])

  // 絶対時刻の共通タイムライン。
  const timeline = useMemo(() => {
    if (!entries || entries.length === 0) return null
    const start = Math.min(...entries.map(e => e.run.startedAt))
    const end = Math.max(...entries.map(e => e.run.finishedAt))
    return { start, durationSec: Math.max(1, (end - start) / 1000) }
  }, [entries])

  const bounds = useMemo(() => {
    if (!entries) return null
    const bbox = computeRunsBbox(entries.map(e => e.run))
    return bbox ? expandBboxByMeters(bbox, 60) : null
  }, [entries])

  // ループ再生する rAF (RunResultPage と同じ要領)。
  useEffect(() => {
    if (!timeline || !playing) return
    let raf = 0
    let start: number | null = null
    const tick = (now: number) => {
      if (start === null) start = now
      const elapsed = ((now - start) / 1000) * REPLAY_SPEED
      const loopSec = elapsed % timeline.durationSec
      setAbsMs(timeline.start + loopSec * 1000)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [timeline, playing])

  const proceed = () => {
    setPlaying(false)
    clearLocal()
    if (myRunId) {
      startPostRunLoading({ x: window.innerWidth / 2, y: window.innerHeight - 80 })
      navigate(`/run/${myRunId}/result`)
    } else {
      navigate('/')
    }
  }

  return (
    <div className="page">
      <div className="map-container">
        {bounds && entries && (
          <BaseMap initialBounds={bounds} initialBoundsPadding={48} interactive={false}>
            <CoRunReplayLayers entries={entries} absMs={absMs} />
          </BaseMap>
        )}
      </div>

      {entries && (
        <div className="co-run-result-legend">
          {entries.map(e => (
            <span key={e.uid} className="co-run-legend-item">
              <span
                className="co-run-legend-swatch"
                style={{ background: `rgb(${e.color[0]},${e.color[1]},${e.color[2]})` }}
              />
              {e.name}
              {e.uid === myUid ? '（あなた）' : ''}
            </span>
          ))}
        </div>
      )}

      <div className="co-run-result-controls">
        <button
          type="button"
          className="co-run-btn co-run-btn-ghost"
          onClick={() => setPlaying(p => !p)}
          aria-label={playing ? '一時停止' : '再生'}
        >
          <Icon icon={playing ? 'lucide:pause' : 'lucide:play'} />
        </button>
        <button type="button" className="co-run-btn co-run-btn-primary" onClick={proceed}>
          次へ
        </button>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------

function CoRunReplayLayers({ entries, absMs }: { entries: Entry[]; absMs: number }) {
  const zoom = useMapZoom()
  const radii = useSettingsStore(s => s.radii)
  const dotRadius = effectiveRadius(zoom, radii.zoomThreshold, radii.dotRadius)
  const tubeWidth = effectiveRadius(zoom, radii.zoomThreshold, radii.tubeRadius) * 2

  // 軌跡 (ポリライン) はメンバーごとに 1 本、色分け。
  const pathData = useMemo(
    () =>
      entries
        .map(e => ({
          uid: e.uid,
          color: e.color,
          path: buildPathPositions(acceptedPoints(e.run.trackPoints)),
        }))
        .filter(d => d.path.length >= 2),
    [entries],
  )

  const layers = useMemo(() => {
    const pathLayer = new PathLayer<{ uid: string; color: [number, number, number]; path: [number, number, number][] }>({
      id: 'co-run-paths',
      data: pathData,
      getPath: d => d.path,
      getColor: d => [...d.color, 170],
      getWidth: tubeWidth,
      widthUnits: 'meters',
      capRounded: true,
      jointRounded: true,
      billboard: true,
    })

    const dotData = entries
      .map(e => {
        const loopSec = (absMs - e.run.startedAt) / 1000
        const pos = positionAtTime(e.run, loopSec)
        return pos ? { position: pos, color: e.color } : null
      })
      .filter((d): d is { position: [number, number]; color: [number, number, number] } => !!d)

    const dotLayer = new ScatterplotLayer<{ position: [number, number]; color: [number, number, number] }>({
      id: 'co-run-dots',
      data: dotData,
      getPosition: d => [d.position[0], d.position[1], 0],
      getRadius: dotRadius * CURRENT_DOT_SCALE,
      radiusUnits: 'meters',
      getFillColor: d => [...d.color, 255],
      billboard: true,
      updateTriggers: { getPosition: absMs },
    })

    return [pathLayer, dotLayer]
  }, [pathData, entries, absMs, dotRadius, tubeWidth])

  return <DeckOverlay layers={layers} />
}
