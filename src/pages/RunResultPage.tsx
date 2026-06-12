import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useRunStore } from '../store/useRunStore'
import { positionAtTime } from '../hooks/useGalleryAnimation'
import { acceptedPoints } from '../utils/geo/recordingFilters'
import { useElevationStats } from '../hooks/useElevationStats'
import { useRunBubblePositioning } from '../hooks/useRunBubblePositioning'
import { useRunMetadata } from '../hooks/useRunMetadata'
import { totalDistance } from '../utils/geo/geoUtils'
import { formatDistance, formatElevation, formatDate } from '../utils/ui/formatters'
import { buildRunSummary } from '../utils/run/runSummary'
import { computeBBox, makeProjector } from '../utils/path/svgProjection'
import { shareSvgAsPng } from '../utils/ui/shareRunImage'
import { loadRun } from '../db/runRepository'
import { useSettingsStore } from '../store/useSettingsStore'
import { REPLAY_SPEED } from '../utils/ui/replaySpeed'
import { useActivePalette } from '../hooks/useActivePalette'
import { usePostRunLoadingStore } from '../store/usePostRunLoadingStore'
import {
  getDialogueService,
  getMemoryStore,
  hasApiKey,
  petampCharacter,
  useCharacterDialogue,
} from '../character'
import type { RelationalState, ThreadId } from '../character'
import { OPENING_TRIGGER_FRESH, OPENING_TRIGGER_RESUME } from '../utils/run/runChatPrompts'
import type { Run } from '../types'

// 9:16 縦長キャンバス
const VB_W = 1080
const VB_H = 1920
const PATH_MARGIN_X = 80
const PATH_MARGIN_TOP = 520
const PATH_MARGIN_BOTTOM = 320
const LOOP_SPEED = REPLAY_SPEED
const STROKE_WIDTH = 10
const DOT_RADIUS = 22

// 右下に置く目玉アイコンの配置 (viewBox 単位)。EyesIcon (VIEW=64) を 4倍に拡大。
const EYES_SCALE = 4
const EYES_X = 800
const EYES_Y = 1680
// タップ判定領域 (目玉の周囲も含めて指で押しやすく)
const EYES_HIT = { x: 760, y: 1660, w: 280, h: 240 }

export function RunResultPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [run, setRun] = useState<Run | null>(null)
  const ui = useSettingsStore(s => s.ui)
  // 結果画面に固定描画される目玉は gallery の 'map' (idle) キーフレームを採用。
  const eyeParams = ui.eyeKeyframes.map
  const { palette } = useActivePalette()
  const { runs, loadRuns } = useRunStore()
  const [runsLoaded, setRunsLoaded] = useState(false)
  const [loopSec, setLoopSec] = useState(0)
  const svgRef = useRef<SVGSVGElement>(null)
  const shareTimerRef = useRef<number | null>(null)
  const [shareStatus, setShareStatus] = useState<'idle' | 'saving' | 'unsupported' | 'failed'>('idle')

  useEffect(() => {
    if (runs.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRunsLoaded(true)
      return
    }
    loadRuns().finally(() => setRunsLoaded(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!id) return
    const inMemory = runs.find(r => r.id === id)
    if (inMemory) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRun(inMemory)
      return
    }
    if (!runsLoaded) return
    loadRun(id).then(r => {
      if (!r) {
        navigate('/', { replace: true })
        return
      }
      setRun(r)
    })
  }, [id, runs, runsLoaded, navigate])

  const acceptedRunPoints = useMemo(() => acceptedPoints(run?.trackPoints ?? []), [run])
  const { gain } = useElevationStats(acceptedRunPoints)

  // ---- ペタンプ第一声の生成 ----
  const apiOk = hasApiKey()
  const service = useMemo(() => (apiOk ? getDialogueService() : null), [apiOk])
  const memory = useMemo(() => getMemoryStore(), [])
  const runSummary = useMemo(() => (run ? buildRunSummary(run) : undefined), [run])
  const refs = useMemo(
    () => (run ? [{ kind: 'run' as const, id: run.id }] : undefined),
    [run],
  )
  const dialogue = useCharacterDialogue({
    characterId: petampCharacter.id,
    service: service!,
    memory,
    defaultRunSummary: runSummary,
    defaultRunPoints: acceptedRunPoints,
    defaultRefs: refs,
  })

  const openedRef = useRef(false)
  const relationalSnapshotRef = useRef<RelationalState | null>(null)
  const threadIdRef = useRef<ThreadId | null>(null)
  const handoffRef = useRef(false)

  useEffect(() => {
    threadIdRef.current = dialogue.threadId
  }, [dialogue.threadId])

  // 初回マウントで opener を 1 度だけ送る (関係値スナップショットも先に取って discard 用に保管)
  useEffect(() => {
    if (!service || !run || openedRef.current) return
    openedRef.current = true
    void memory.getRelational(petampCharacter.id).then(s => {
      relationalSnapshotRef.current = s ?? null
    })
    void memory
      .queryEpisodic({
        characterId: petampCharacter.id,
        relatedTo: [{ kind: 'run', id: run.id }],
      })
      .then(episodic => {
        const opener = episodic.length > 0 ? OPENING_TRIGGER_RESUME : OPENING_TRIGGER_FRESH
        void dialogue.send(opener)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, run, memory])

  // アンマウント時、対話画面に引き継いでいないスレッドは破棄する
  useEffect(() => {
    return () => {
      if (handoffRef.current) return
      const tid = threadIdRef.current
      if (service && tid) {
        void service.discardThread(tid, relationalSnapshotRef.current)
      }
    }
  }, [service])

  const firstPetampTurn = useMemo(
    () => dialogue.messages.find(t => t.role === 'character') ?? null,
    [dialogue.messages],
  )

  // ラン終了の post-run loading 画面を抜ける合図。
  // 第一声が届いた / API キーが無く対話自体不可 / 15秒のセーフティ — のいずれかで ready。
  const setPostRunLoadingReady = usePostRunLoadingStore(s => s.setReady)
  useEffect(() => {
    if (!service || firstPetampTurn) {
      setPostRunLoadingReady()
      return
    }
    const t = window.setTimeout(setPostRunLoadingReady, 15000)
    return () => window.clearTimeout(t)
  }, [service, firstPetampTurn, setPostRunLoadingReady])

  const eyesGroupRef = useRef<SVGGElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)

  // 吹き出し位置を目玉の bounding rect から動的に決める (svg は letterbox される可能性があるため)。
  // 吹き出しは目玉の真上、画面端 16px でクランプ。
  useRunBubblePositioning(eyesGroupRef, bubbleRef, !!firstPetampTurn, firstPetampTurn, {
    offsetX: 32,
    gap: 16,
    clampMargin: 16,
  })

  const handleEyesClick = () => {
    if (!run) return
    handoffRef.current = true
    // 引き継ぐ thread id は firstPetampTurn から取る (バブルが見えている=この値は確実に存在する)。
    // state はリロードや strict mode の挙動で失われ得るため sessionStorage を一次経路にする。
    const tid = firstPetampTurn?.threadId ?? dialogue.threadId ?? null
    if (tid) {
      try {
        sessionStorage.setItem(`runChatHandoff:${run.id}`, tid)
      } catch {
        // sessionStorage 不可でも遷移自体は止めない
      }
    }
    navigate(`/run/${run.id}/chat`)
  }

  // 過去のラン (areaName未保存) を初回表示時にバックフィル
  useRunMetadata(run, setRun)

  useEffect(() => {
    if (!run) return
    const duration = Math.max(0, (run.finishedAt - run.startedAt) / 1000)
    if (duration <= 0) return
    let raf = 0
    let start: number | null = null
    const tick = (now: number) => {
      if (start === null) start = now
      const elapsed = ((now - start) / 1000) * LOOP_SPEED
      setLoopSec(elapsed % duration)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [run])

  const bbox = useMemo(() => computeBBox(acceptedRunPoints), [acceptedRunPoints])
  const project = useMemo(() => {
    if (!bbox) return null
    return makeProjector(bbox, {
      x: PATH_MARGIN_X,
      y: PATH_MARGIN_TOP,
      w: VB_W - PATH_MARGIN_X * 2,
      h: VB_H - PATH_MARGIN_TOP - PATH_MARGIN_BOTTOM,
    })
  }, [bbox])

  const polylinePoints = useMemo(() => {
    if (!project || acceptedRunPoints.length === 0) return ''
    return acceptedRunPoints.map(p => {
      const [x, y] = project(p.lng, p.lat)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    }).join(' ')
  }, [acceptedRunPoints, project])

  const dotPos = useMemo(() => {
    if (!run || !project) return null
    const pos = positionAtTime(run, loopSec)
    if (!pos) return null
    return project(pos[0], pos[1])
  }, [run, loopSec, project])

  useEffect(() => () => {
    if (shareTimerRef.current !== null) window.clearTimeout(shareTimerRef.current)
  }, [])

  if (!run) return <div className="page loading">読み込み中...</div>

  const dist = totalDistance(acceptedRunPoints)

  // SVG → 1080x1920 PNG → OS シェアシート (Web Share API)
  // 端末への保存は OS のシェアシートに任せる。Web Share API 非対応環境は SP 想定外として明示する。
  const handleShare = async () => {
    const svgEl = svgRef.current
    if (!svgEl) return
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
      setShareStatus('unsupported')
      if (shareTimerRef.current !== null) window.clearTimeout(shareTimerRef.current)
      shareTimerRef.current = window.setTimeout(() => setShareStatus('idle'), 2200)
      return
    }
    setShareStatus('saving')
    try {
      await shareSvgAsPng(svgEl, {
        width: VB_W,
        height: VB_H,
        name: run.name,
        fallbackUrl: window.location.href,
      })
      setShareStatus('idle')
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') {
        // ユーザーがシェアシートを閉じただけ
        setShareStatus('idle')
        return
      }
      console.error('[result] share failed', e)
      setShareStatus('failed')
      if (shareTimerRef.current !== null) window.clearTimeout(shareTimerRef.current)
      shareTimerRef.current = window.setTimeout(() => setShareStatus('idle'), 2200)
    }
  }

  const shareLabel = (() => {
    switch (shareStatus) {
      case 'saving': return 'PREPARING…'
      case 'unsupported': return 'UNSUPPORTED'
      case 'failed': return 'FAILED'
      default: return 'SHARE'
    }
  })()

  return (
    <div className="page run-result-page">
      <svg
        ref={svgRef}
        className="run-result-svg"
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <rect x={0} y={0} width={VB_W} height={VB_H} fill={palette.bg} />

        {polylinePoints && (
          <polyline
            points={polylinePoints}
            fill="none"
            stroke="#ffffff"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {dotPos && (
          <circle cx={dotPos[0]} cy={dotPos[1]} r={DOT_RADIUS} fill="#ffffff" />
        )}

        {/* メタ情報（書き出し画像にも含まれる） */}
        <g
          fill="#ffffff"
          fontFamily="system-ui, -apple-system, 'Helvetica Neue', 'Hiragino Sans', sans-serif"
        >
          <text x={80} y={180} fontSize={56} fontWeight={700}>{run.name}</text>
          <text x={80} y={232} fontSize={28} opacity={0.8}>{formatDate(run.startedAt)}</text>
          {run.areaName && (
            <text
              x={80}
              y={284}
              fontSize={26}
              fontWeight={600}
              letterSpacing={4}
              opacity={0.9}
            >
              {run.areaName.toUpperCase()}
            </text>
          )}
          <text x={80} y={372} fontSize={22} opacity={0.7} letterSpacing={1.4} fontWeight={600}>距離</text>
          <text x={240} y={376} fontSize={52} fontWeight={700}>{formatDistance(dist)}</text>
          <text x={80} y={444} fontSize={22} opacity={0.7} letterSpacing={1.4} fontWeight={600}>獲得標高</text>
          <text x={240} y={448} fontSize={52} fontWeight={700}>↑{formatElevation(gain)}</text>
        </g>

        {/* 右下のペタンプ。タップで /run/:id/chat へ。書き出し画像にも同じ位置で含まれる。 */}
        <g
          ref={eyesGroupRef}
          onClick={handleEyesClick}
          style={{ cursor: 'pointer' }}
          role="button"
          aria-label="このランについてペタンプと話す"
        >
          <rect
            x={EYES_HIT.x}
            y={EYES_HIT.y}
            width={EYES_HIT.w}
            height={EYES_HIT.h}
            fill="transparent"
          />
          <g transform={`translate(${EYES_X} ${EYES_Y}) scale(${EYES_SCALE})`}>
            {/* X offset は遷移中だけ効く仕様なので、静止描画である Result では 0 固定。 */}
            <ellipse
              cx={22}
              cy={32 + eyeParams.eyeYOffset}
              rx={8 * eyeParams.eyeSizeScale}
              ry={11 * eyeParams.eyeSizeScale}
              fill="#ffffff"
            />
            <ellipse
              cx={42}
              cy={32 + eyeParams.eyeYOffset}
              rx={8 * eyeParams.eyeSizeScale}
              ry={11 * eyeParams.eyeSizeScale}
              fill="#ffffff"
            />
            <circle
              cx={22}
              cy={32 + eyeParams.eyeYOffset}
              r={6 * eyeParams.pupilSizeScale}
              fill="#0a0a0a"
            />
            <circle
              cx={42}
              cy={32 + eyeParams.eyeYOffset}
              r={6 * eyeParams.pupilSizeScale}
              fill="#0a0a0a"
            />
          </g>
        </g>
      </svg>

      <div className="run-result-actions">
        <button
          type="button"
          className="run-result-link"
          onClick={handleShare}
          disabled={shareStatus === 'saving'}
        >
          {shareLabel}
        </button>
        <button
          type="button"
          className="run-result-link"
          onClick={() => navigate('/')}
        >
          FINISH
        </button>
      </div>

      {firstPetampTurn && (
        <div
          ref={bubbleRef}
          className="run-result-bubble"
          key={firstPetampTurn.id}
          onClick={handleEyesClick}
          role="button"
        >
          {firstPetampTurn.content}
        </div>
      )}

      {!firstPetampTurn && dialogue.isThinking && (
        <div className="run-result-thinking">ペタンプが考え中…</div>
      )}
    </div>
  )
}
