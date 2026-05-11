import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useRunStore } from '../store/useRunStore'
import { positionAtTime } from '../hooks/useGalleryAnimation'
import { acceptedPoints } from '../utils/recordingFilters'
import { useElevationStats } from '../hooks/useElevationStats'
import { fetchAreaName } from '../hooks/useReverseGeocode'
import { totalDistance } from '../utils/geoUtils'
import { formatDistance, formatElevation, formatDate } from '../utils/formatters'
import { buildRunSummary } from '../utils/runSummary'
import { loadRun } from '../db/runRepository'
import { useSettingsStore } from '../store/useSettingsStore'
import {
  getDialogueService,
  getMemoryStore,
  hasApiKey,
  petampCharacter,
  useCharacterDialogue,
} from '../character'
import type { RelationalState, ThreadId } from '../character'
import { OPENING_TRIGGER_FRESH, OPENING_TRIGGER_RESUME } from '../utils/runChatPrompts'
import type { Run, TrackPoint } from '../types'

// 9:16 縦長キャンバス
const VB_W = 1080
const VB_H = 1920
const PATH_MARGIN_X = 80
const PATH_MARGIN_TOP = 520
const PATH_MARGIN_BOTTOM = 320
const LOOP_SPEED = 60
const STROKE_WIDTH = 10
const DOT_RADIUS = 22
const ACCENT = '#1c975e'

// 右下に置く目玉アイコンの配置 (viewBox 単位)。EyesIcon (VIEW=64) を 4倍に拡大。
const EYES_SCALE = 4
const EYES_X = 800
const EYES_Y = 1680
// タップ判定領域 (目玉の周囲も含めて指で押しやすく)
const EYES_HIT = { x: 760, y: 1660, w: 280, h: 240 }

interface BBox { lngMin: number; lngMax: number; latMin: number; latMax: number }
interface Target { x: number; y: number; w: number; h: number }

function computeBBox(pts: TrackPoint[]): BBox | null {
  if (pts.length === 0) return null
  let lngMin = Infinity, lngMax = -Infinity, latMin = Infinity, latMax = -Infinity
  for (const p of pts) {
    if (p.lng < lngMin) lngMin = p.lng
    if (p.lng > lngMax) lngMax = p.lng
    if (p.lat < latMin) latMin = p.lat
    if (p.lat > latMax) latMax = p.lat
  }
  return { lngMin, lngMax, latMin, latMax }
}

// 軌跡の bbox を target 矩形内に等比フィット。緯度方向の歪みを cosLat で軽く補正。
function makeProjector(bbox: BBox, target: Target) {
  const bw = bbox.lngMax - bbox.lngMin || 1e-9
  const bh = bbox.latMax - bbox.latMin || 1e-9
  const cosLat = Math.cos(((bbox.latMin + bbox.latMax) / 2) * Math.PI / 180)
  const scaledBw = bw * cosLat
  const aspectPath = scaledBw / bh
  const aspectTarget = target.w / target.h
  let drawW: number, drawH: number
  if (aspectPath > aspectTarget) {
    drawW = target.w
    drawH = target.w / aspectPath
  } else {
    drawH = target.h
    drawW = target.h * aspectPath
  }
  const ox = target.x + (target.w - drawW) / 2
  const oy = target.y + (target.h - drawH) / 2
  return (lng: number, lat: number): [number, number] => {
    const nx = ((lng - bbox.lngMin) * cosLat) / scaledBw
    const ny = 1 - (lat - bbox.latMin) / bh
    return [ox + nx * drawW, oy + ny * drawH]
  }
}

function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'run'
}

export function RunResultPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [run, setRun] = useState<Run | null>(null)
  const ui = useSettingsStore(s => s.ui)
  const { runs, loadRuns, updateRun } = useRunStore()
  const [runsLoaded, setRunsLoaded] = useState(false)
  const [loopSec, setLoopSec] = useState(0)
  const svgRef = useRef<SVGSVGElement>(null)
  const shareTimerRef = useRef<number | null>(null)
  const [shareStatus, setShareStatus] = useState<'idle' | 'saving' | 'unsupported' | 'failed'>('idle')

  useEffect(() => {
    if (runs.length > 0) {
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

  const eyesGroupRef = useRef<SVGGElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)

  // 吹き出し位置を目玉の bounding rect から動的に決める (svg は letterbox される可能性があるため)
  useEffect(() => {
    if (!firstPetampTurn) return
    const place = () => {
      const eyes = eyesGroupRef.current
      const bubble = bubbleRef.current
      if (!eyes || !bubble) return
      const r = eyes.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const w = bubble.offsetWidth
      const h = bubble.offsetHeight
      // 吹き出しは目玉の真上、目玉の中心を右下に向くように左寄せ
      const left = Math.max(16, Math.min(window.innerWidth - w - 16, cx - w + 32))
      const top = Math.max(16, r.top - 16 - h)
      bubble.style.left = `${left}px`
      bubble.style.top = `${top}px`
    }
    place()
    const ro = new ResizeObserver(place)
    if (eyesGroupRef.current) ro.observe(eyesGroupRef.current)
    if (bubbleRef.current) ro.observe(bubbleRef.current)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [firstPetampTurn])

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
  useEffect(() => {
    if (!run || run.areaName) return
    const lats = run.trackPoints.map(p => p.lat)
    const lngs = run.trackPoints.map(p => p.lng)
    if (lats.length === 0) return
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2
    fetchAreaName(centerLng, centerLat).then(name => {
      if (!name) return
      updateRun(run.id, { areaName: name }).then(updated => {
        if (updated) setRun(updated)
      })
    })
  }, [run?.id, run?.areaName, run, updateRun])

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
    let svgUrl: string | null = null
    try {
      const clone = svgEl.cloneNode(true) as SVGSVGElement
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      clone.setAttribute('width', String(VB_W))
      clone.setAttribute('height', String(VB_H))
      const svgString = new XMLSerializer().serializeToString(clone)
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
      svgUrl = URL.createObjectURL(svgBlob)
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('svg load failed'))
        img.src = svgUrl!
      })
      const canvas = document.createElement('canvas')
      canvas.width = VB_W
      canvas.height = VB_H
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas 2d unavailable')
      ctx.drawImage(img, 0, 0, VB_W, VB_H)
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
      if (!blob) throw new Error('encode failed')
      const file = new File([blob], `${safeFileName(run.name)}.png`, { type: 'image/png' })
      const canShareFiles =
        typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
      if (canShareFiles) {
        await navigator.share({ files: [file], title: run.name })
      } else {
        // ファイル共有非対応（主にデスクトップ）→ URL のみで OS シェアシートを開く
        await navigator.share({ title: run.name, url: window.location.href })
      }
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
    } finally {
      if (svgUrl) URL.revokeObjectURL(svgUrl)
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
        <defs>
          <linearGradient id="rr-fade-top" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={1} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="rr-fade-bottom" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={1} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>

        <rect x={0} y={0} width={VB_W} height={VB_H} fill={ACCENT} />

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

        {/* 上下に緑→透明のグラデーションを重ねて軌跡の端を馴染ませる */}
        <rect x={0} y={0} width={VB_W} height={VB_H * 0.16} fill="url(#rr-fade-top)" />
        <rect x={0} y={VB_H * 0.84} width={VB_W} height={VB_H * 0.16} fill="url(#rr-fade-bottom)" />

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
            <ellipse
              cx={22}
              cy={32 + ui.eyeYOffset}
              rx={8 * ui.eyeSizeScale}
              ry={11 * ui.eyeSizeScale}
              fill="#ffffff"
            />
            <ellipse
              cx={42}
              cy={32 + ui.eyeYOffset}
              rx={8 * ui.eyeSizeScale}
              ry={11 * ui.eyeSizeScale}
              fill="#ffffff"
            />
            <circle
              cx={22}
              cy={32 + ui.eyeYOffset}
              r={6 * ui.pupilSizeScale}
              fill="#0a0a0a"
            />
            <circle
              cx={42}
              cy={32 + ui.eyeYOffset}
              r={6 * ui.pupilSizeScale}
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
