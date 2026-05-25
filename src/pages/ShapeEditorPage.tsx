import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { EyesIcon } from '../components/gallery/EyesIcon'
import { ModalPopup } from '../components/ModalPopup'
import { useMetaballSheet, type PeakAnchorTuple } from '../hooks/useMetaballSheet'
import { useEyeParams } from '../hooks/useEyeParams'
import {
  useSettingsStore,
  NAV_STATES,
  NAV_STATE_LABEL,
  type EyeParams,
  type NavState,
} from '../store/useSettingsStore'
import { useTransitionStore } from '../store/useTransitionStore'

// 4-anchor cubic-bezier blob editor for designing the "moving FAB" silhouette.
// Anchors are stored in local coords centred at (0,0). The peak shape is what
// the user designs; the rest shape is a fixed reference circle.

type Pt = [number, number]

interface Anchor {
  pos: Pt
  handleIn: Pt   // offset from pos toward the previous anchor
  handleOut: Pt  // offset from pos toward the next anchor
}

const KAPPA = 0.5522847498
const R = 80 // rest radius in editor units

const REST_ANCHORS: [Anchor, Anchor, Anchor, Anchor] = [
  { pos: [0, -R], handleIn: [-R * KAPPA, 0], handleOut: [R * KAPPA, 0] },   // top
  { pos: [R, 0],  handleIn: [0, -R * KAPPA], handleOut: [0, R * KAPPA] },   // right
  { pos: [0, R],  handleIn: [R * KAPPA, 0],  handleOut: [-R * KAPPA, 0] },  // bottom
  { pos: [-R, 0], handleIn: [0, R * KAPPA],  handleOut: [0, -R * KAPPA] },  // left
]

// useMetaballSheet で実際に使われている PEAK_RIGHT と一致させる初期値。
// 編集を開いた時点で本番と同じ形が出るので、その上から差分を入れていける。
const DEFAULT_PEAK_ANCHORS: [Anchor, Anchor, Anchor, Anchor] = [
  { pos: [45.8, -89.79], handleIn: [-58.46, -0.14], handleOut: [50, 0] },
  { pos: [68.77, 28.19], handleIn: [51.1, -37.04], handleOut: [-41.43, 32.52] },
  { pos: [-72.67, 66.83], handleIn: [44.18, 0], handleOut: [-44.18, 0] },
  { pos: [-85.8, -0.41], handleIn: [-52.48, -1.13], handleOut: [46.62, 1.42] },
]

function buildPath(anchors: Anchor[], cx: number, cy: number): string {
  const tx = (p: Pt) => p[0] + cx
  const ty = (p: Pt) => p[1] + cy
  const a = anchors
  const segs: string[] = []
  for (let i = 0; i < 4; i++) {
    const cur = a[i]
    const next = a[(i + 1) % 4]
    const c1: Pt = [cur.pos[0] + cur.handleOut[0], cur.pos[1] + cur.handleOut[1]]
    const c2: Pt = [next.pos[0] + next.handleIn[0], next.pos[1] + next.handleIn[1]]
    segs.push(`C ${tx(c1)} ${ty(c1)}, ${tx(c2)} ${ty(c2)}, ${tx(next.pos)} ${ty(next.pos)}`)
  }
  return `M ${tx(a[0].pos)} ${ty(a[0].pos)} ${segs.join(' ')} Z`
}

const EDITOR_W = 480
const EDITOR_H = 360
const EDITOR_CX = EDITOR_W / 2
const EDITOR_CY = EDITOR_H / 2
// 編集用 SVG 上で目玉を描く scale。EyesIcon の viewBox (0..64) を peak の
// 半径 R=80 に揃えるため 80/32 = 2.5 を採用する。
const EDITOR_EYE_SCALE = 2.5

type DragKind = 'pos' | 'in' | 'out'
interface DragState { anchorIdx: number; kind: DragKind }

// 各アンカーのハンドル制約モード。
//  - 'free': handleIn / handleOut を完全独立に操作
//  - 'aligned': handleIn と handleOut はアンカーを通る直線上に拘束。長さは独立。
//    ハンドルをドラッグすると共有直線が回転し、もう一方は反対側の射線上で
//    既存の長さを保ったまま向きだけ追従する。
type HandleMode = 'free' | 'aligned'
type ModesTuple = [HandleMode, HandleMode, HandleMode, HandleMode]

// クリック判定の閾値 (px / ms)。ポインター移動量と時間がこの範囲なら
// アンカー click として扱い、ドラッグではなくモードトグルに振り分ける。
const CLICK_MAX_DIST = 5
const CLICK_MAX_TIME_MS = 350

const ANCHOR_LABELS = ['top', 'right', 'bottom', 'left'] as const

export function ShapeEditorPage() {
  const [peak, setPeak] = useState<[Anchor, Anchor, Anchor, Anchor]>(DEFAULT_PEAK_ANCHORS)
  const [modes, setModes] = useState<ModesTuple>(['free', 'free', 'free', 'free'])
  const [drag, setDrag] = useState<DragState | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const editorRef = useRef<SVGSVGElement>(null)
  // click vs drag 判定用。anchor pos の pointerdown 時に start を記録し、
  // pointermove で最大移動量を更新、pointerup でしきい値判定する。
  const pointerStartRef = useRef({ x: 0, y: 0, time: 0 })
  const pointerMaxDistRef = useRef(0)

  // 2 つの独立した state:
  //  - editKeyframe: サイドバー & エディタ SVG が表示・編集中のキーフレーム
  //  - navState: プレビューカード (本物 nav) の runtime 状態
  // プレビューで遷移を試しても編集中のキーフレームは切り替わらないように分離。
  // 編集対象の切替はキーフレームオーバービューの行クリックで行う。
  const [editKeyframe, setEditKeyframe] = useState<NavState>('map')
  const [navState, setNavState] = useState<NavState>('map')

  const eyeKeyframes = useSettingsStore(s => s.ui.eyeKeyframes)
  const setEyeKeyframe = useSettingsStore(s => s.setEyeKeyframe)
  // エディタ SVG 内の目玉は編集中のキーフレームを反映 (スライダー編集の
  // リアルタイムプレビュー)。eyeXOffset は bell ピーク値そのものを表示。
  const editorEye = eyeKeyframes[editKeyframe]

  const restPath = useMemo(() => buildPath(REST_ANCHORS, EDITOR_CX, EDITOR_CY), [])
  const peakPath = useMemo(() => buildPath(peak, EDITOR_CX, EDITOR_CY), [peak])

  // useMetaballSheet に渡す tuple 形式の peak。peak state が更新されると次フレームから反映。
  const peakTuple = useMemo<PeakAnchorTuple[]>(
    () => peak.map(a => ({ pos: a.pos, handleIn: a.handleIn, handleOut: a.handleOut })),
    [peak],
  )

  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      const svg = editorRef.current
      if (!svg) return
      // pos drag を click と区別するためのポインター総移動量を更新する。
      const dist = Math.hypot(
        e.clientX - pointerStartRef.current.x,
        e.clientY - pointerStartRef.current.y,
      )
      if (dist > pointerMaxDistRef.current) pointerMaxDistRef.current = dist

      const rect = svg.getBoundingClientRect()
      // SVG renders at CSS size but coords are in viewBox units → scale.
      const scaleX = EDITOR_W / rect.width
      const scaleY = EDITOR_H / rect.height
      const sx = (e.clientX - rect.left) * scaleX - EDITOR_CX
      const sy = (e.clientY - rect.top) * scaleY - EDITOR_CY
      setPeak(prev => {
        const next = prev.slice() as [Anchor, Anchor, Anchor, Anchor]
        const a = { ...next[drag.anchorIdx] }
        const aligned = modes[drag.anchorIdx] === 'aligned'

        if (drag.kind === 'pos') {
          a.pos = [sx, sy]
        } else {
          const newOff: Pt = [sx - a.pos[0], sy - a.pos[1]]
          if (drag.kind === 'in') a.handleIn = newOff
          else a.handleOut = newOff
          if (aligned) {
            // 反対側のハンドルを既存長さを保って反対方向に再配置。
            const other: Pt = drag.kind === 'in' ? a.handleOut : a.handleIn
            const otherLen = Math.hypot(other[0], other[1])
            const newLen = Math.hypot(newOff[0], newOff[1])
            if (newLen > 1e-6) {
              const dirX = -newOff[0] / newLen
              const dirY = -newOff[1] / newLen
              const mirrored: Pt = [dirX * otherLen, dirY * otherLen]
              if (drag.kind === 'in') a.handleOut = mirrored
              else a.handleIn = mirrored
            }
          }
        }
        next[drag.anchorIdx] = a
        return next
      })
    }
    const onUp = () => {
      // anchor 本体を pos ドラッグしてほぼ動いていない場合は click と見なし、
      // 該当アンカーのモードをトグルする。free → aligned に入る瞬間は
      // handleIn を handleOut の反対側に snap して直線を整える。
      if (drag.kind === 'pos') {
        const moved = pointerMaxDistRef.current
        const elapsed = Date.now() - pointerStartRef.current.time
        if (moved < CLICK_MAX_DIST && elapsed < CLICK_MAX_TIME_MS) {
          const idx = drag.anchorIdx
          const wasFree = modes[idx] === 'free'
          setModes(prev => {
            const next = prev.slice() as ModesTuple
            next[idx] = next[idx] === 'free' ? 'aligned' : 'free'
            return next
          })
          if (wasFree) {
            // free → aligned: handleOut の向きを基準に handleIn を反対側へ整える。
            // handleOut が 0 長なら handleIn の向きを基準にする。
            setPeak(prev => {
              const np = prev.slice() as [Anchor, Anchor, Anchor, Anchor]
              const a = { ...np[idx] }
              const outLen = Math.hypot(a.handleOut[0], a.handleOut[1])
              const inLen = Math.hypot(a.handleIn[0], a.handleIn[1])
              if (outLen > 1e-6) {
                const dx = -a.handleOut[0] / outLen
                const dy = -a.handleOut[1] / outLen
                a.handleIn = [dx * inLen, dy * inLen]
              } else if (inLen > 1e-6) {
                const dx = -a.handleIn[0] / inLen
                const dy = -a.handleIn[1] / inLen
                a.handleOut = [dx * outLen, dy * outLen]
              }
              np[idx] = a
              return np
            })
          }
        }
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, modes])

  const updateField = (i: number, kind: DragKind, axis: 0 | 1, val: number) => {
    setPeak(prev => {
      const next = prev.slice() as [Anchor, Anchor, Anchor, Anchor]
      const a = { ...next[i] }
      const target: Pt = kind === 'pos' ? [...a.pos] as Pt
        : kind === 'in' ? [...a.handleIn] as Pt
        : [...a.handleOut] as Pt
      target[axis] = val
      if (kind === 'pos') a.pos = target
      else if (kind === 'in') a.handleIn = target
      else a.handleOut = target
      next[i] = a
      return next
    })
  }

  const exportCode = useMemo(() => {
    const fmt = (n: number) => Number(n.toFixed(2))
    const arr = peak.map(a => ({
      pos: a.pos.map(fmt),
      handleIn: a.handleIn.map(fmt),
      handleOut: a.handleOut.map(fmt),
    }))
    return JSON.stringify(arr, null, 2)
  }, [peak])

  return (
    <div className="shape-editor">
      <header className="shape-editor-header">
        <h1>Shape Editor</h1>
        <a href="/" className="link-ghost">← Gallery</a>
      </header>

      <section className="shape-editor-grid">
        <svg
          ref={editorRef}
          className="shape-editor-svg"
          viewBox={`0 0 ${EDITOR_W} ${EDITOR_H}`}
          width={EDITOR_W}
          height={EDITOR_H}
        >
          <path d={restPath} fill="none" stroke="rgba(255,255,255,0.18)" strokeDasharray="4 4" />
          <path d={peakPath} fill="rgba(28,151,94,0.85)" stroke="rgba(28,151,94,1)" />
          <EditorEyes eye={editorEye} />
          {peak.map((a, i) => {
            const ax = a.pos[0] + EDITOR_CX
            const ay = a.pos[1] + EDITOR_CY
            const inX = ax + a.handleIn[0]
            const inY = ay + a.handleIn[1]
            const outX = ax + a.handleOut[0]
            const outY = ay + a.handleOut[1]
            return (
              <g key={i}>
                <line x1={inX} y1={inY} x2={ax} y2={ay} stroke="#888" strokeWidth={1} />
                <line x1={ax} y1={ay} x2={outX} y2={outY} stroke="#888" strokeWidth={1} />
                <circle cx={inX} cy={inY} r={5} fill="#fff"
                  onPointerDown={(e) => { e.stopPropagation(); setDrag({ anchorIdx: i, kind: 'in' }) }}
                  style={{ cursor: 'grab' }} />
                <circle cx={outX} cy={outY} r={5} fill="#fff"
                  onPointerDown={(e) => { e.stopPropagation(); setDrag({ anchorIdx: i, kind: 'out' }) }}
                  style={{ cursor: 'grab' }} />
                <circle cx={ax} cy={ay} r={7}
                  fill={modes[i] === 'aligned' ? '#ffffff' : '#1c975e'}
                  stroke={modes[i] === 'aligned' ? '#1c975e' : '#ffffff'}
                  strokeWidth={2}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    pointerStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() }
                    pointerMaxDistRef.current = 0
                    setDrag({ anchorIdx: i, kind: 'pos' })
                  }}
                  style={{ cursor: 'grab' }} />
                <text x={ax + 12} y={ay - 10} fill="#fff" fontSize={11}>
                  {ANCHOR_LABELS[i]}{modes[i] === 'aligned' ? ' ·aligned' : ''}
                </text>
              </g>
            )
          })}
        </svg>

        <NumericPanel
          peak={peak}
          onChange={updateField}
          onReset={() => setPeak(DEFAULT_PEAK_ANCHORS)}
          editKeyframe={editKeyframe}
          onEditKeyframeChange={setEditKeyframe}
          eyeKeyframes={eyeKeyframes}
          onEyeKeyframeChange={(state, patch) => setEyeKeyframe(state, patch)}
        />
      </section>

      <NavPreviewSection
        peakTuple={peakTuple}
        navState={navState}
        onNavStateChange={setNavState}
      />

      <section className="shape-editor-export">
        <button className="btn-ghost" onClick={() => setExportOpen(true)}>
          JSON を表示 / コピー
        </button>
      </section>

      {exportOpen && (
        <ModalPopup title="Export JSON" onClose={() => setExportOpen(false)}>
          <ExportPopupBody code={exportCode} />
        </ModalPopup>
      )}
    </div>
  )
}

function ExportPopupBody({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* noop */
    }
  }
  return (
    <div className="shape-editor-export-popup">
      <div className="shape-editor-export-actions">
        <button className="btn-ghost" onClick={handleCopy}>
          {copied ? 'コピーしました' : 'Copy JSON'}
        </button>
      </div>
      <pre className="shape-editor-export-pre">{code}</pre>
    </div>
  )
}

// ===== Editor SVG: 目玉オーバーレイ =====

function EditorEyes({ eye }: { eye: EyeParams }) {
  // EyesIcon 内部の eye 座標 (viewBox 0..64) を editor 座標に EDITOR_EYE_SCALE で拡大。
  // 22, 42 → 左右の眼の中心 X (viewBox 単位)。
  // 32 + eyeYOffset → 眼の中心 Y (viewBox 単位)
  // eyeXOffset は runtime では遷移中だけ効くが、エディタ側ではスライダー値の
  // 視覚フィードバックとして bell の peak (= 設定値) を直接適用して表示する。
  const leftX = EDITOR_CX + (22 - 32 + eye.eyeXOffset) * EDITOR_EYE_SCALE
  const rightX = EDITOR_CX + (42 - 32 + eye.eyeXOffset) * EDITOR_EYE_SCALE
  const cy = EDITOR_CY + eye.eyeYOffset * EDITOR_EYE_SCALE
  const rx = 8 * eye.eyeSizeScale * EDITOR_EYE_SCALE
  const ry = 11 * eye.eyeSizeScale * EDITOR_EYE_SCALE
  const pR = 6 * eye.pupilSizeScale * EDITOR_EYE_SCALE
  return (
    <g pointerEvents="none">
      <ellipse cx={leftX} cy={cy} rx={rx} ry={ry} fill="#ffffff" />
      <ellipse cx={rightX} cy={cy} rx={rx} ry={ry} fill="#ffffff" />
      <circle cx={leftX} cy={cy} r={pR} fill="#0a0a0a" />
      <circle cx={rightX} cy={cy} r={pR} fill="#0a0a0a" />
    </g>
  )
}

// ===== Numeric / sliders panel (anchor sliders + eye keyframe sliders) =====

interface NumericPanelProps {
  peak: [Anchor, Anchor, Anchor, Anchor]
  onChange: (i: number, kind: DragKind, axis: 0 | 1, val: number) => void
  onReset: () => void
  editKeyframe: NavState
  onEditKeyframeChange: (s: NavState) => void
  eyeKeyframes: Record<NavState, EyeParams>
  onEyeKeyframeChange: (state: NavState, patch: Partial<EyeParams>) => void
}

function NumericPanel({
  peak, onChange, onReset,
  editKeyframe, onEditKeyframeChange,
  eyeKeyframes, onEyeKeyframeChange,
}: NumericPanelProps) {
  return (
    <div className="shape-editor-numeric">
      <h3 className="shape-editor-section-h">Peak アンカー</h3>
      {peak.map((a, i) => (
        <div key={i} className="anchor-block">
          <h3>{ANCHOR_LABELS[i]}</h3>
          <NumRow label="pos" v={a.pos} onChange={(ax, val) => onChange(i, 'pos', ax, val)} />
          <NumRow label="in"  v={a.handleIn}  onChange={(ax, val) => onChange(i, 'in', ax, val)} />
          <NumRow label="out" v={a.handleOut} onChange={(ax, val) => onChange(i, 'out', ax, val)} />
        </div>
      ))}
      <button className="btn-ghost" onClick={onReset}>Reset peak</button>

      <hr className="shape-editor-divider" />

      <h3 className="shape-editor-section-h">
        目玉キーフレーム: {NAV_STATE_LABEL[editKeyframe]}
      </h3>
      <p className="shape-editor-kf-hint">
        編集対象は下の表の行をタップで切替。プレビュー操作とは独立。
      </p>

      <KeyframeEditor
        state={editKeyframe}
        params={eyeKeyframes[editKeyframe]}
        onChange={patch => onEyeKeyframeChange(editKeyframe, patch)}
      />

      <KeyframeOverview
        keyframes={eyeKeyframes}
        active={editKeyframe}
        onSelect={onEditKeyframeChange}
      />
    </div>
  )
}

function NumRow({ label, v, onChange }: { label: string; v: Pt; onChange: (axis: 0 | 1, val: number) => void }) {
  return (
    <div className="anchor-row">
      <span className="anchor-label">{label}</span>
      <input type="number" value={Number(v[0].toFixed(2))} step={1}
        onChange={e => onChange(0, Number(e.currentTarget.value))} />
      <input type="number" value={Number(v[1].toFixed(2))} step={1}
        onChange={e => onChange(1, Number(e.currentTarget.value))} />
    </div>
  )
}

interface KeyframeEditorProps {
  state: NavState
  params: EyeParams
  onChange: (patch: Partial<EyeParams>) => void
}

function KeyframeEditor({ state, params, onChange }: KeyframeEditorProps) {
  return (
    <div className="shape-editor-keyframe-fields" key={state}>
      <KFSlider
        label="アイコンサイズ"
        unit="px"
        min={28} max={96} step={1}
        value={params.fabIconSize}
        onChange={v => onChange({ fabIconSize: v })}
      />
      <KFSlider
        label="目の縦位置"
        hint="− 上 / + 下"
        unit=""
        min={-12} max={12} step={1}
        value={params.eyeYOffset}
        onChange={v => onChange({ eyeYOffset: v })}
      />
      <KFSlider
        label="目の横位置 (遷移中のみ)"
        hint="移動中に bell shape で適用 / − 左 / + 右"
        unit=""
        min={-12} max={12} step={1}
        value={params.eyeXOffset}
        onChange={v => onChange({ eyeXOffset: v })}
      />
      <KFSlider
        label="白目サイズ倍率"
        unit="x"
        min={0.6} max={1.6} step={0.05}
        value={params.eyeSizeScale}
        onChange={v => onChange({ eyeSizeScale: v })}
      />
      <KFSlider
        label="瞳サイズ倍率"
        unit="x"
        min={0.6} max={1.6} step={0.05}
        value={params.pupilSizeScale}
        onChange={v => onChange({ pupilSizeScale: v })}
      />
    </div>
  )
}

function KFSlider({
  label, hint, unit, min, max, step, value, onChange,
}: {
  label: string; hint?: string; unit: string;
  min: number; max: number; step: number;
  value: number; onChange: (v: number) => void;
}) {
  const decimals = step < 1 ? 2 : 0
  return (
    <label className="shape-editor-kf-slider">
      <span className="shape-editor-kf-head">
        <span className="shape-editor-kf-label">{label}</span>
        <span className="shape-editor-kf-value">{value.toFixed(decimals)}{unit}</span>
      </span>
      {hint && <span className="shape-editor-kf-hint">{hint}</span>}
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.currentTarget.value))}
      />
    </label>
  )
}

function KeyframeOverview({
  keyframes, active, onSelect,
}: {
  keyframes: Record<NavState, EyeParams>
  active: NavState
  onSelect?: (s: NavState) => void
}) {
  return (
    <div className="shape-editor-kf-overview">
      <div className="shape-editor-kf-overview-head">
        <span>state</span>
        <span>icon</span>
        <span>eyeX</span>
        <span>eyeY</span>
        <span>scale</span>
        <span>pupil</span>
      </div>
      {NAV_STATES.map(s => {
        const p = keyframes[s]
        const isActive = active === s
        const className = `shape-editor-kf-overview-row${isActive ? ' is-active' : ''}${onSelect ? ' is-selectable' : ''}`
        return (
          <div
            key={s}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-pressed={onSelect ? isActive : undefined}
            className={className}
            onClick={onSelect ? () => onSelect(s) : undefined}
            onKeyDown={onSelect ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s) }
            } : undefined}
          >
            <span>{NAV_STATE_LABEL[s]}</span>
            <span>{p.fabIconSize.toFixed(0)}</span>
            <span>{p.eyeXOffset.toFixed(0)}</span>
            <span>{p.eyeYOffset.toFixed(0)}</span>
            <span>{p.eyeSizeScale.toFixed(2)}</span>
            <span>{p.pupilSizeScale.toFixed(2)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ===== Nav preview (旧 PreviewSection の置き換え): 実際の bottom-sheet + FAB + 目玉 =====

interface NavPreviewProps {
  peakTuple: PeakAnchorTuple[]
  navState: NavState
  onNavStateChange: (s: NavState) => void
}

function NavPreviewSection({ peakTuple, navState, onNavStateChange }: NavPreviewProps) {
  const view: 'map' | 'list' | 'profile' = navState === 'armed' ? 'map' : navState
  const armed = navState === 'armed'

  const cardRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const armedRef = useRef(armed)
  // useMetaballSheet が armedRef.current を毎フレーム読む。state 反映に追従させる。
  // eslint-disable-next-line react-hooks/refs
  armedRef.current = armed
  useMetaballSheet({ canvasRef, sheetRef, fabRef, armedRef, peakAnchors: peakTuple })

  const liveEye = useEyeParams(navState)

  // navState 変化時にまばたき。
  const [blinkSignal, setBlinkSignal] = useState(0)
  const didMountRef = useRef(false)
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true
      return
    }
    setBlinkSignal(s => s + 1)
  }, [navState])

  const handleFab = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!armed) {
      onNavStateChange('armed')
      return
    }
    // 本物と同じく armed → /record へ遷移 (TransitionOverlay の iris 演出)。
    const fab = fabRef.current
    if (!fab) return
    const rect = fab.getBoundingClientRect()
    const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    useTransitionStore.getState().startRecord(origin, null)
  }

  const handleListClick = () => {
    if (armed) return
    onNavStateChange(navState === 'list' ? 'map' : 'list')
  }
  const handleProfileClick = () => {
    if (armed) return
    onNavStateChange(navState === 'profile' ? 'map' : 'profile')
  }
  const handleMapClick = () => {
    if (armed) return
    onNavStateChange('map')
  }

  return (
    <section className="shape-editor-preview">
      <div className="preview-controls">
        <h2>Preview</h2>
        <span className="preview-phase">
          state: {NAV_STATE_LABEL[navState]}
        </span>
      </div>

      <div ref={cardRef} className="shape-editor-nav-card">
        {/* armed 時のバックドロップはカード内だけを暗くする (ページ全体は塞がない)。 */}
        {armed && (
          <div className="shape-editor-nav-backdrop" onClick={() => onNavStateChange('map')} />
        )}

        {/* metaball-canvas は fullscreen-fixed のまま (FAB の screen-coord 周りに描画)。
            カードに含めても fixed なので位置は viewport 基準。 */}
        <canvas ref={canvasRef} className="metaball-canvas" />

        <div ref={sheetRef} className={`bottom-sheet ${armed ? 'armed' : ''}`}>
          <div className="bottom-sheet-shape">
            <button
              className={`list-toggle-btn${view === 'list' ? ' is-active' : ''}`}
              onClick={handleListClick}
              aria-label={view === 'list' ? 'ラン一覧を閉じる' : 'ラン一覧を開く'}
            >
              <Icon icon="lucide:layout-list" />
            </button>
            <button
              ref={fabRef}
              className={`fab fab-sheet${view !== 'map' && !armed ? ` fab-pos-${view}` : ''}`}
              onClick={handleFab}
              aria-label={armed ? 'TAP TO START' : '記録開始'}
            >
              <span
                className="fab-icon"
                style={{ width: liveEye.fabIconSize, height: liveEye.fabIconSize }}
              >
                <EyesIcon blinkSignal={blinkSignal} params={liveEye} />
              </span>
            </button>
            <button
              className={`map-btn${view === 'map' ? ' is-active' : ''}`}
              onClick={handleMapClick}
              aria-label="マップに戻る"
              title="マップ"
            >
              <Icon icon="lucide:map" />
            </button>
            <button
              className={`profile-btn${view === 'profile' ? ' is-active' : ''}`}
              onClick={handleProfileClick}
              aria-label={view === 'profile' ? 'プロフィールを閉じる' : 'プロフィールを開く'}
              title="プロフィール"
            >
              <Icon icon="lucide:user" />
            </button>
          </div>
        </div>
      </div>

      <p className="preview-note">
        右パネルのタブまたはカード内ボタンで状態を切り替え。armed で FAB タップ = /record へ遷移。
      </p>
    </section>
  )
}
