import { useEffect, useMemo, useRef, useState } from 'react'

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

// Default peak: leaning RIGHT (motion direction = right). Apex pulled forward,
// trailing (left) side stretched outward into a long slope.
const DEFAULT_PEAK_ANCHORS: [Anchor, Anchor, Anchor, Anchor] = [
  { pos: [30, -85], handleIn: [-50, -10], handleOut: [50, 0] },
  { pos: [R, 0],    handleIn: [0, -R * KAPPA], handleOut: [0, R * KAPPA] },
  { pos: [0, R],    handleIn: [R * KAPPA, 0], handleOut: [-R * KAPPA, 0] },
  { pos: [-60, 0],  handleIn: [-5, 50], handleOut: [10, -55] },
]

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }
function lerpPt(a: Pt, b: Pt, t: number): Pt { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)] }
function lerpAnchor(a: Anchor, b: Anchor, t: number): Anchor {
  return {
    pos: lerpPt(a.pos, b.pos, t),
    handleIn: lerpPt(a.handleIn, b.handleIn, t),
    handleOut: lerpPt(a.handleOut, b.handleOut, t),
  }
}

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

type DragKind = 'pos' | 'in' | 'out'
interface DragState { anchorIdx: number; kind: DragKind }

const ANCHOR_LABELS = ['top', 'right', 'bottom', 'left'] as const

export function ShapeEditorPage() {
  const [peak, setPeak] = useState<[Anchor, Anchor, Anchor, Anchor]>(DEFAULT_PEAK_ANCHORS)
  const [drag, setDrag] = useState<DragState | null>(null)
  const editorRef = useRef<SVGSVGElement>(null)

  const restPath = useMemo(() => buildPath(REST_ANCHORS, EDITOR_CX, EDITOR_CY), [])
  const peakPath = useMemo(() => buildPath(peak, EDITOR_CX, EDITOR_CY), [peak])

  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      const svg = editorRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const sx = e.clientX - rect.left - EDITOR_CX
      const sy = e.clientY - rect.top - EDITOR_CY
      setPeak(prev => {
        const next = prev.slice() as [Anchor, Anchor, Anchor, Anchor]
        const a = { ...next[drag.anchorIdx] }
        if (drag.kind === 'pos') a.pos = [sx, sy]
        else if (drag.kind === 'in') a.handleIn = [sx - a.pos[0], sy - a.pos[1]]
        else a.handleOut = [sx - a.pos[0], sy - a.pos[1]]
        next[drag.anchorIdx] = a
        return next
      })
    }
    const onUp = () => setDrag(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag])

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
                <circle cx={ax} cy={ay} r={6} fill="#1c975e" stroke="#fff" strokeWidth={2}
                  onPointerDown={(e) => { e.stopPropagation(); setDrag({ anchorIdx: i, kind: 'pos' }) }}
                  style={{ cursor: 'grab' }} />
                <text x={ax + 10} y={ay - 10} fill="#fff" fontSize={11}>{ANCHOR_LABELS[i]}</text>
              </g>
            )
          })}
        </svg>

        <NumericPanel peak={peak} onChange={updateField} onReset={() => setPeak(DEFAULT_PEAK_ANCHORS)} />
      </section>

      <PreviewSection peak={peak} />

      <section className="shape-editor-export">
        <h2>Export</h2>
        <pre>{exportCode}</pre>
        <button
          className="btn-ghost"
          onClick={() => navigator.clipboard?.writeText(exportCode)}
        >
          Copy JSON
        </button>
      </section>
    </div>
  )
}

interface NumericPanelProps {
  peak: [Anchor, Anchor, Anchor, Anchor]
  onChange: (i: number, kind: DragKind, axis: 0 | 1, val: number) => void
  onReset: () => void
}

function NumericPanel({ peak, onChange, onReset }: NumericPanelProps) {
  return (
    <div className="shape-editor-numeric">
      {peak.map((a, i) => (
        <div key={i} className="anchor-block">
          <h3>{ANCHOR_LABELS[i]}</h3>
          <NumRow label="pos" v={a.pos} onChange={(ax, val) => onChange(i, 'pos', ax, val)} />
          <NumRow label="in"  v={a.handleIn}  onChange={(ax, val) => onChange(i, 'in', ax, val)} />
          <NumRow label="out" v={a.handleOut} onChange={(ax, val) => onChange(i, 'out', ax, val)} />
        </div>
      ))}
      <button className="btn-ghost" onClick={onReset}>Reset peak</button>
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

const PREVIEW_W = 600
const PREVIEW_H = 220
const DURATION = 1200 // ms one-way

function PreviewSection({ peak }: { peak: [Anchor, Anchor, Anchor, Anchor] }) {
  const [t, setT] = useState(0) // 0..1, full cycle (0 → 1 → 0 over 2*DURATION)
  const startRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const [playing, setPlaying] = useState(true)

  useEffect(() => {
    if (!playing) return
    const tick = (ts: number) => {
      if (!startRef.current) startRef.current = ts
      const elapsed = (ts - startRef.current) % (DURATION * 2)
      setT(elapsed / (DURATION * 2)) // 0..1
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [playing])

  // Position: triangle wave 0 → 1 → 0
  const pos = t < 0.5 ? t * 2 : 2 - t * 2
  const goingRight = t < 0.5

  // Deformation: bell at midpoints of each leg (0.25 and 0.75)
  const deform = Math.abs(Math.sin(t * Math.PI * 2)) // peaks at 0.25 and 0.75

  const interpolated = useMemo<[Anchor, Anchor, Anchor, Anchor]>(() => [
    lerpAnchor(REST_ANCHORS[0], peak[0], deform),
    lerpAnchor(REST_ANCHORS[1], peak[1], deform),
    lerpAnchor(REST_ANCHORS[2], peak[2], deform),
    lerpAnchor(REST_ANCHORS[3], peak[3], deform),
  ], [deform, peak])

  const margin = 100
  const cx = lerp(margin, PREVIEW_W - margin, pos)
  const cy = PREVIEW_H / 2
  const path = useMemo(() => buildPath(interpolated, cx, cy), [interpolated, cx, cy])

  return (
    <section className="shape-editor-preview">
      <div className="preview-controls">
        <h2>Preview</h2>
        <button className="btn-ghost" onClick={() => setPlaying(p => !p)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="preview-phase">
          t: {t.toFixed(2)} | deform: {deform.toFixed(2)} | dir: {goingRight ? '→' : '←'}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`}
        width={PREVIEW_W}
        height={PREVIEW_H}
        className="preview-svg"
      >
        <line x1={0} y1={cy} x2={PREVIEW_W} y2={cy} stroke="rgba(255,255,255,0.1)" />
        {/* mirror the shape on the return leg so the lean follows motion */}
        <g transform={goingRight ? '' : `translate(${2 * cx} 0) scale(-1 1)`}>
          <path d={path} fill="rgba(28,151,94,0.85)" />
        </g>
      </svg>
      <p className="preview-note">
        Default peak leans RIGHT (= forward when motion direction is →).
        Return trip mirrors horizontally so apex always leads the bump.
      </p>
    </section>
  )
}
