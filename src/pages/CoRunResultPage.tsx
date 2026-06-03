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
import { usePostRunLoadingStore } from '../store/usePostRunLoadingStore'
import { cloudGetRunOf } from '../firebase/runCloud'
import type { Run } from '../types'

// メンバーごとの色 (最大 8 人ぶん。超過分は循環)。
const MEMBER_COLORS: [number, number, number][] = [
  [28, 151, 94],
  [232, 101, 90],
  [90, 142, 232],
  [232, 198, 90],
  [168, 90, 232],
  [90, 218, 210],
  [232, 140, 90],
  [200, 200, 200],
]

const CURRENT_DOT_SCALE = 1.2

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
  const startPostRunLoading = usePostRunLoadingStore(s => s.start)

  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [playing, setPlaying] = useState(true)
  const [absMs, setAbsMs] = useState(0)

  // セッションが失われている (リロード等) ときは自分のランへフォールバック。
  useEffect(() => {
    if (session && session.id === sessionId) return
    if (myRunId) navigate(`/run/${myRunId}/result`, { replace: true })
    else navigate('/', { replace: true })
  }, [session, sessionId, myRunId, navigate])

  // 参加者全員のランを読み込む (自分はローカル、他参加者はクラウド)。
  useEffect(() => {
    if (!session || session.id !== sessionId) return
    let cancelled = false
    void (async () => {
      const active = session.memberUids.filter(uid => {
        const m = session.members[uid]
        return !!m && !!m.runId && m.state === 'finished'
      })
      const loaded = await Promise.all(
        active.map(async (uid, i): Promise<Entry | null> => {
          const runId = session.members[uid].runId!
          const run =
            uid === myUid
              ? localRuns.find(r => r.id === runId) ?? (await cloudGetRunOf(uid, runId))
              : await cloudGetRunOf(uid, runId)
          if (!run) return null
          return {
            uid,
            run,
            color: MEMBER_COLORS[i % MEMBER_COLORS.length],
            name: session.members[uid].displayName || '匿名ランナー',
          }
        }),
      )
      if (cancelled) return
      setEntries(loaded.filter((e): e is Entry => !!e))
    })()
    return () => {
      cancelled = true
    }
  }, [session, sessionId, myUid, localRuns])

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
