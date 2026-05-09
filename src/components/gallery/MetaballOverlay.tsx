import { useEffect, useRef, type RefObject } from 'react'

// Hardcoded peak shape exported from /shape-editor (anchors normalised to NORM_R=80).
const KAPPA = 0.5522847498
const NORM_R = 80

interface Pt { x: number; y: number }
interface Anchor { pos: Pt; handleIn: Pt; handleOut: Pt }

const REST: Anchor[] = [
  { pos: { x: 0, y: -NORM_R }, handleIn: { x: -NORM_R * KAPPA, y: 0 }, handleOut: { x: NORM_R * KAPPA, y: 0 } },
  { pos: { x: NORM_R, y: 0 }, handleIn: { x: 0, y: -NORM_R * KAPPA }, handleOut: { x: 0, y: NORM_R * KAPPA } },
  { pos: { x: 0, y: NORM_R }, handleIn: { x: NORM_R * KAPPA, y: 0 }, handleOut: { x: -NORM_R * KAPPA, y: 0 } },
  { pos: { x: -NORM_R, y: 0 }, handleIn: { x: 0, y: NORM_R * KAPPA }, handleOut: { x: 0, y: -NORM_R * KAPPA } },
]

const PEAK_RIGHT: Anchor[] = [
  { pos: { x: 45.8, y: -89.79 }, handleIn: { x: -58.46, y: -0.14 }, handleOut: { x: 50, y: 0 } },
  { pos: { x: 68.77, y: 28.19 }, handleIn: { x: 51.1, y: -37.04 }, handleOut: { x: -41.43, y: 32.52 } },
  { pos: { x: -72.67, y: 66.83 }, handleIn: { x: 44.18, y: 0 }, handleOut: { x: -44.18, y: 0 } },
  { pos: { x: -85.8, y: -0.41 }, handleIn: { x: -52.48, y: -1.13 }, handleOut: { x: 46.62, y: 1.42 } },
]

// Mirror across X for leftward motion: simple X negation on every coord.
const PEAK_LEFT: Anchor[] = PEAK_RIGHT.map(a => ({
  pos: { x: -a.pos.x, y: a.pos.y },
  handleIn: { x: -a.handleIn.x, y: a.handleIn.y },
  handleOut: { x: -a.handleOut.x, y: a.handleOut.y },
}))

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }
function lerpPt(a: Pt, b: Pt, t: number): Pt { return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) } }
function lerpAnchor(a: Anchor, b: Anchor, t: number): Anchor {
  return {
    pos: lerpPt(a.pos, b.pos, t),
    handleIn: lerpPt(a.handleIn, b.handleIn, t),
    handleOut: lerpPt(a.handleOut, b.handleOut, t),
  }
}

function buildPath(anchors: Anchor[], cx: number, cy: number, scale: number): string {
  const tx = (n: number) => cx + n * scale
  const ty = (n: number) => cy + n * scale
  const segs: string[] = []
  for (let i = 0; i < 4; i++) {
    const cur = anchors[i]
    const next = anchors[(i + 1) % 4]
    segs.push(
      `C ${tx(cur.pos.x + cur.handleOut.x)} ${ty(cur.pos.y + cur.handleOut.y)}, ` +
      `${tx(next.pos.x + next.handleIn.x)} ${ty(next.pos.y + next.handleIn.y)}, ` +
      `${tx(next.pos.x)} ${ty(next.pos.y)}`,
    )
  }
  return `M ${tx(anchors[0].pos.x)} ${ty(anchors[0].pos.y)} ${segs.join(' ')} Z`
}

interface Props {
  sheetRef: RefObject<HTMLElement | null>
  fabRef: RefObject<HTMLElement | null>
  /** When true (armed → record-confirm modal transition), blob stays a perfect
      circle and only follows FAB's CSS scale — the legacy "just change radius" behavior. */
  armed: boolean
  /** Velocity (px/frame) at which deformation reaches peak. */
  peakVelocity?: number
}

export function MetaballOverlay({ sheetRef, fabRef, armed, peakVelocity = 6 }: Props) {
  const rectRef = useRef<SVGRectElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const stateRef = useRef({
    prevX: 0,
    velocity: 0,
    deform: 0,
    direction: 1, // +1 right, -1 left
    initialised: false,
    raf: 0,
    armed: false,
  })

  // Keep latest armed value reachable from inside RAF without re-subscribing the loop.
  stateRef.current.armed = armed

  useEffect(() => {
    const sheet = sheetRef.current
    const fab = fabRef.current
    const rect = rectRef.current
    const path = pathRef.current
    if (!sheet || !fab || !rect || !path) return
    const st = stateRef.current

    const tick = () => {
      const sRect = sheet.getBoundingClientRect()
      const fRect = fab.getBoundingClientRect()
      const cx = fRect.left + fRect.width / 2
      const cy = fRect.top + fRect.height / 2
      // FAB radius in CSS px (includes any active CSS transform scale, e.g. armed=1.8x).
      const radius = Math.min(fRect.width, fRect.height) / 2

      let v = 0
      if (st.initialised) v = cx - st.prevX
      st.prevX = cx
      st.initialised = true

      st.velocity = st.velocity * 0.7 + v * 0.3

      let targetDeform = Math.min(1, Math.abs(st.velocity) / peakVelocity)
      // Armed transition is purely a radius scale — suppress bezier deform.
      if (st.armed) targetDeform = 0
      const k = targetDeform > st.deform ? 0.35 : 0.18
      st.deform += (targetDeform - st.deform) * k

      if (Math.abs(st.velocity) > 0.1) {
        st.direction = st.velocity > 0 ? 1 : -1
      }

      const peak = st.direction > 0 ? PEAK_RIGHT : PEAK_LEFT
      const blob = REST.map((r, i) => lerpAnchor(r, peak[i], st.deform))
      const scale = radius / NORM_R

      // Sheet rect (rounded box). Extend a bit upward so the blob's bottom always
      // overlaps the rect even when the sheet is mostly translated off-screen.
      rect.setAttribute('x', String(sRect.left))
      rect.setAttribute('y', String(sRect.top))
      rect.setAttribute('width', String(sRect.width))
      rect.setAttribute('height', String(sRect.height + 4))

      path.setAttribute('d', buildPath(blob, cx, cy, scale))

      st.raf = requestAnimationFrame(tick)
    }

    st.raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(st.raf)
  }, [sheetRef, fabRef, peakVelocity])

  return (
    <svg className="metaball-svg" aria-hidden="true">
      <defs>
        {/* Classic SVG-metaball: blur, then threshold via the alpha channel
            (last row of feColorMatrix). The blur radius and threshold control
            how far apart shapes can be while still merging. */}
        <filter id="metaball-filter" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
          <feColorMatrix
            in="blur"
            mode="matrix"
            values="
              1 0 0 0 0
              0 1 0 0 0
              0 0 1 0 0
              0 0 0 24 -10
            "
          />
        </filter>
      </defs>
      <g filter="url(#metaball-filter)" fill="var(--accent)">
        <rect ref={rectRef} rx={16} ry={16} />
        <path ref={pathRef} />
      </g>
    </svg>
  )
}
