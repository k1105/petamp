import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { PathLayer } from '@deck.gl/layers'
import { EyesIcon } from '../components/gallery/EyesIcon'
import { BaseMap, useMap, useMapZoom } from '../components/map/BaseMap'
import { DeckOverlay } from '../components/map/DeckOverlay'
import { useRunStore } from '../store/useRunStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { loadRun } from '../db/runRepository'
import { buildRunSummary } from '../utils/runSummary'
import { acceptedPoints } from '../utils/recordingFilters'
import { effectiveRadius } from '../utils/effectiveRadius'
import { buildPathPositions } from '../utils/tubeMesh'
import { hexToRgb } from '../utils/themePalettes'
import { useActivePalette } from '../hooks/useActivePalette'
import {
  CLOSING_NOTE,
  OPENING_TRIGGER_FRESH,
  OPENING_TRIGGER_RESUME,
  isHiddenTriggerContent,
} from '../utils/runChatPrompts'
import {
  getDialogueService,
  getMemoryStore,
  hasApiKey,
  petampCharacter,
  useCharacterDialogue,
} from '../character'
import type {
  DialogueTurn,
  EpisodicMemory,
  RelationalState,
  RunSegment,
  RunSummary,
  ThreadId,
} from '../character'
import type { Run } from '../types'

const MAX_PETAMP_TURNS = 5

function isHidden(turn: DialogueTurn): boolean {
  return turn.role === 'user' && isHiddenTriggerContent(turn.content)
}

interface VisiblePair {
  petamp: DialogueTurn | null
  user: DialogueTurn | null
}

/**
 * 「ペタンプ発話 + ユーザ返答」の最新ペアだけを抽出。新しいペタンプ発話が来たら
 * userは一度クリアされ、次のユーザ返答で再びセットされる。
 */
function deriveVisiblePair(messages: DialogueTurn[]): VisiblePair {
  let petamp: DialogueTurn | null = null
  let user: DialogueTurn | null = null
  for (const t of messages) {
    if (isHidden(t)) continue
    if (t.role === 'character') {
      petamp = t
      user = null
    } else {
      user = t
    }
  }
  return { petamp, user }
}

export function RunChatPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  // 結果画面からの引き継ぎ thread id。sessionStorage を一次経路、location.state を予備。
  // useState 初期化子で 1 回だけ取って固定する (location.state は strict mode 遷移などで失われる場合があるため)。
  const [handoffThreadId] = useState<ThreadId | undefined>(() => {
    if (!id) return undefined
    let v: string | null = null
    try {
      v = sessionStorage.getItem(`runChatHandoff:${id}`)
    } catch {
      // sessionStorage 不可なら state を見る
    }
    const fromState = (location.state as { handoffThreadId?: ThreadId } | null)?.handoffThreadId
    return (v as ThreadId | null) ?? fromState ?? undefined
  })
  // 一度取り出したら消す (戻ってきたとき再利用されないように)
  useEffect(() => {
    if (!id) return
    try {
      sessionStorage.removeItem(`runChatHandoff:${id}`)
    } catch {
      // ignore
    }
  }, [id])
  const { runs, loadRuns } = useRunStore()
  const [run, setRun] = useState<Run | null>(null)
  const [runsLoaded, setRunsLoaded] = useState(false)
  const [input, setInput] = useState('')
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
  const [newEpisodic, setNewEpisodic] = useState<EpisodicMemory | null>(null)
  const relationalSnapshotRef = useRef<RelationalState | null>(null)
  const discardedRef = useRef(false)
  const closedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    if (runs.length > 0) {
      Promise.resolve().then(() => {
        if (!cancelled) setRunsLoaded(true)
      })
    } else {
      loadRuns().finally(() => {
        if (!cancelled) setRunsLoaded(true)
      })
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    const inMemory = runs.find(r => r.id === id)
    if (inMemory) {
      Promise.resolve().then(() => {
        if (!cancelled) setRun(inMemory)
      })
      return () => {
        cancelled = true
      }
    }
    if (!runsLoaded) return
    loadRun(id).then(r => {
      if (cancelled) return
      if (!r) {
        navigate('/', { replace: true })
        return
      }
      setRun(r)
    })
    return () => {
      cancelled = true
    }
  }, [id, runs, runsLoaded, navigate])

  const apiOk = hasApiKey()
  const service = useMemo(() => (apiOk ? getDialogueService() : null), [apiOk])
  const memory = useMemo(() => getMemoryStore(), [])
  const runSummary = useMemo<RunSummary | undefined>(
    () => (run ? buildRunSummary(run) : undefined),
    [run],
  )
  const refs = useMemo(
    () => (run ? [{ kind: 'run' as const, id: run.id }] : undefined),
    [run],
  )
  const initialBounds = useMemo(():
    | [[number, number], [number, number]]
    | undefined => {
    if (!run) return undefined
    const pts = acceptedPoints(run.trackPoints)
    if (pts.length === 0) return undefined
    const lngs = pts.map(p => p.lng)
    const lats = pts.map(p => p.lat)
    return [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ]
  }, [run])

  const dialogue = useCharacterDialogue({
    characterId: petampCharacter.id,
    service: service!,
    memory,
    threadId: handoffThreadId,
    defaultRunSummary: runSummary,
    defaultRefs: refs,
  })


  const openedRef = useRef(false)
  useEffect(() => {
    if (!service || !run || openedRef.current) return
    openedRef.current = true
    void memory.getRelational(petampCharacter.id).then(snapshot => {
      relationalSnapshotRef.current = snapshot ?? null
    })
    // 結果画面から引き継いだスレッドなら opener はすでに発話済み。
    if (handoffThreadId) return
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
  }, [service, run, memory, handoffThreadId])

  const threadIdRef = useRef<ThreadId | null>(null)
  useEffect(() => {
    threadIdRef.current = dialogue.threadId
  }, [dialogue.threadId])
  const runSummaryRef = useRef(runSummary)
  useEffect(() => {
    runSummaryRef.current = runSummary
  }, [runSummary])
  useEffect(() => {
    return () => {
      if (discardedRef.current || closedRef.current) return
      const tid = threadIdRef.current
      if (service && tid) void service.closeThread(tid, runSummaryRef.current)
    }
  }, [service])

  const visiblePair = useMemo(
    () => deriveVisiblePair(dialogue.messages),
    [dialogue.messages],
  )

  const petampTurnCount = useMemo(
    () => dialogue.messages.filter(t => t.role === 'character').length,
    [dialogue.messages],
  )
  const sessionEnded = petampTurnCount >= MAX_PETAMP_TURNS

  useEffect(() => {
    if (!sessionEnded || closedRef.current) return
    if (!service) return
    closedRef.current = true
    void dialogue.close().then(ep => {
      if (ep) setNewEpisodic(ep)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEnded, service])

  const highlightSegmentIndex = useMemo<number | null>(() => {
    const t = visiblePair.petamp?.topic
    if (!t) return null
    if (t.kind !== 'segment') return null
    return typeof t.segmentIndex === 'number' ? t.segmentIndex : null
  }, [visiblePair.petamp])

  const onSend = () => {
    if (sessionEnded) return
    const text = input.trim()
    if (!text) return
    setInput('')
    const isClosingTurn = petampTurnCount === MAX_PETAMP_TURNS - 1
    void dialogue.send(text, isClosingTurn ? { extraSystemNote: CLOSING_NOTE } : undefined)
  }

  const goBack = () => {
    navigate(`/run/${run!.id}`)
  }

  const onCloseTap = () => {
    if (petampTurnCount === 0 || sessionEnded) {
      goBack()
      return
    }
    setConfirmDiscardOpen(true)
  }

  const onConfirmDiscard = async () => {
    setConfirmDiscardOpen(false)
    const tid = threadIdRef.current
    if (service && tid) {
      discardedRef.current = true
      await service.discardThread(tid, relationalSnapshotRef.current)
    }
    goBack()
  }

  if (!apiOk) {
    return (
      <div className="page" style={{ padding: 24, color: 'var(--text)' }}>
        <p>VITE_GEMINI_API_KEY が設定されていません。</p>
        <button className="btn-ghost" onClick={() => navigate(-1)}>戻る</button>
      </div>
    )
  }

  if (!run) {
    return <div className="page loading">読み込み中...</div>
  }

  const petampBubbleText = visiblePair.petamp?.content ?? null

  return (
    <div className="chat-page">
      {!sessionEnded && (
        <>
          <div className="chat-map-bg">
            <BaseMap
              initialBounds={initialBounds}
              initialBoundsPadding={80}
              initialBoundsMaxZoom={17}
              lockTarget
            >
              <ChatLayers
                run={run}
                segments={runSummary?.segments ?? []}
                highlightSegmentIndex={highlightSegmentIndex}
              />
            </BaseMap>
          </div>

          <div className="chat-eye"><EyesIcon /></div>

          <div className="chat-indicator" aria-label={`残りペタンプ発話 ${MAX_PETAMP_TURNS - petampTurnCount}`}>
            {Array.from({ length: MAX_PETAMP_TURNS }).map((_, i) => (
              <span
                key={i}
                className={`chat-indicator-dot ${i < petampTurnCount ? 'filled' : ''}`}
              />
            ))}
          </div>

          <button className="chat-close-btn" onClick={onCloseTap} aria-label="閉じる">
            <Icon icon="lucide:x" width={18} height={18} />
          </button>

          {petampBubbleText && (
            <div className="chat-petamp-area" key={visiblePair.petamp?.id ?? 'turn'}>
              <div className="chat-petamp-bubble">{petampBubbleText}</div>
              {dialogue.lastPromptLogId && visiblePair.petamp && (
                <div className="chat-petamp-rate">
                  <button
                    onClick={() => void dialogue.rate(dialogue.lastPromptLogId!, true)}
                    aria-label="good"
                    title="good"
                  >
                    <Icon icon="lucide:thumbs-up" width={16} height={16} />
                  </button>
                  <button
                    onClick={() => void dialogue.rate(dialogue.lastPromptLogId!, false)}
                    aria-label="bad"
                    title="bad"
                  >
                    <Icon icon="lucide:thumbs-down" width={16} height={16} />
                  </button>
                </div>
              )}
            </div>
          )}

          {dialogue.isThinking && (
            <div className="chat-thinking-pill">ペタンプが考え中…</div>
          )}

          {visiblePair.user && (
            <div className="chat-user-bubble" key={visiblePair.user.id}>
              {visiblePair.user.content}
            </div>
          )}

          {dialogue.error && (
            <div className="chat-error-pill">エラー: {dialogue.error.message}</div>
          )}

          <footer className="chat-input-area">
            <textarea
              className="chat-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  onSend()
                }
              }}
              rows={1}
              placeholder="ペタンプに話しかける…"
            />
            <button
              className="chat-send-btn"
              onClick={onSend}
              disabled={!input.trim() || dialogue.isThinking}
              aria-label="送信"
            >
              <Icon icon="lucide:arrow-up" width={20} height={20} />
            </button>
          </footer>
        </>
      )}

      {sessionEnded && (
        <div className="chat-ending">
          <div className="chat-ending-eye"><EyesIcon /></div>
          {newEpisodic ? (
            <div className="chat-ending-summary">{newEpisodic.summary}</div>
          ) : (
            <div className="chat-ending-summary chat-ending-loading">
              きょうのこと、おぼえてるね…
            </div>
          )}
          <button
            className="chat-ending-btn"
            onClick={goBack}
            disabled={!newEpisodic}
          >
            おわる
          </button>
        </div>
      )}

      {confirmDiscardOpen && (
        <div className="chat-modal-backdrop" role="dialog" aria-modal="true">
          <div className="chat-modal">
            <p className="chat-modal-text">中断しますか？ここまでの会話は破棄されます。</p>
            <div className="chat-modal-actions">
              <button
                className="chat-modal-btn chat-modal-btn-cancel"
                onClick={() => setConfirmDiscardOpen(false)}
              >
                キャンセル
              </button>
              <button
                className="chat-modal-btn chat-modal-btn-confirm"
                onClick={() => void onConfirmDiscard()}
              >
                破棄して戻る
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------- Map layers + camera control ------------- */

interface ChatLayersProps {
  run: Run
  segments: RunSegment[]
  highlightSegmentIndex: number | null
}

function ChatLayers({ run, segments, highlightSegmentIndex }: ChatLayersProps) {
  const zoom = useMapZoom()
  const { map } = useMap()
  const radii = useSettingsStore(s => s.radii)
  const pts = useMemo(() => acceptedPoints(run.trackPoints), [run])
  const { palette } = useActivePalette()
  const accentRgb = useMemo<[number, number, number]>(
    () => hexToRgb(palette.accent),
    [palette.accent],
  )

  const tubeWidth = effectiveRadius(zoom, radii.zoomThreshold, radii.tubeRadius) * 2
  const highlightWidth = tubeWidth * 1.6

  const wholePath = useMemo(() => buildPathPositions(pts), [pts])

  const highlightSlice = useMemo(() => {
    if (highlightSegmentIndex === null) return null
    const seg = segments.find(s => s.index === highlightSegmentIndex)
    if (!seg) return null
    return pts.slice(seg.startPointIdx, seg.endPointIdx + 1)
  }, [highlightSegmentIndex, segments, pts])

  const highlightPath = useMemo(
    () => (highlightSlice && highlightSlice.length >= 2 ? buildPathPositions(highlightSlice) : null),
    [highlightSlice],
  )

  // カメラ: 全体ハイライトなら全bbox、segmentなら segment slice の bbox にfit
  useEffect(() => {
    if (!map) return
    const target = highlightSlice ?? pts
    if (target.length < 2) return
    const lngs = target.map(p => p.lng)
    const lats = target.map(p => p.lat)
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ]
    map.fitBounds(bounds, { padding: 100, duration: 700, maxZoom: 18 })
  }, [map, highlightSlice, pts])

  const layers = useMemo(() => {
    const result = []
    if (wholePath.length >= 2) {
      const dimAlpha = highlightSegmentIndex !== null ? 110 : 220
      const wholeColor: [number, number, number, number] = [...accentRgb, dimAlpha]
      result.push(
        new PathLayer({
          id: 'chat-whole-tube',
          data: [wholePath],
          getPath: d => d,
          getColor: wholeColor,
          getWidth: tubeWidth,
          widthUnits: 'meters',
          capRounded: true,
          jointRounded: true,
          billboard: true,
          updateTriggers: { getColor: wholeColor },
        }),
      )
    }
    if (highlightPath) {
      result.push(
        new PathLayer({
          id: 'chat-highlight-tube',
          data: [highlightPath],
          getPath: d => d,
          getColor: [180, 255, 200, 255],
          getWidth: highlightWidth,
          widthUnits: 'meters',
          capRounded: true,
          jointRounded: true,
          billboard: true,
        }),
      )
    }
    return result
  }, [wholePath, highlightPath, highlightSegmentIndex, accentRgb, tubeWidth, highlightWidth])

  return <DeckOverlay layers={layers} />
}
