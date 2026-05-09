import { useEffect, useRef, type RefObject } from 'react'

// Hardcoded peak shape exported from /shape-editor.
// Anchors normalised so that the rest circle has radius R=80; runtime scales
// to the actual FAB radius.
const KAPPA = 0.5522847498
const NORM_R = 80

interface Pt { x: number; y: number }
interface Anchor {
  pos: Pt
  handleIn: Pt
  handleOut: Pt
}

const REST: [Anchor, Anchor, Anchor, Anchor] = [
  { pos: { x: 0, y: -NORM_R }, handleIn: { x: -NORM_R * KAPPA, y: 0 }, handleOut: { x: NORM_R * KAPPA, y: 0 } },
  { pos: { x: NORM_R, y: 0 }, handleIn: { x: 0, y: -NORM_R * KAPPA }, handleOut: { x: 0, y: NORM_R * KAPPA } },
  { pos: { x: 0, y: NORM_R }, handleIn: { x: NORM_R * KAPPA, y: 0 }, handleOut: { x: -NORM_R * KAPPA, y: 0 } },
  { pos: { x: -NORM_R, y: 0 }, handleIn: { x: 0, y: NORM_R * KAPPA }, handleOut: { x: 0, y: -NORM_R * KAPPA } },
]

// Peak shape designed in /shape-editor — leans RIGHT (motion direction = →).
const PEAK_RIGHT: [Anchor, Anchor, Anchor, Anchor] = [
  { pos: { x: 45.8, y: -89.79 }, handleIn: { x: -58.46, y: -0.14 }, handleOut: { x: 50, y: 0 } },
  { pos: { x: 68.77, y: 28.19 }, handleIn: { x: 51.1, y: -37.04 }, handleOut: { x: -41.43, y: 32.52 } },
  { pos: { x: -72.67, y: 66.83 }, handleIn: { x: 44.18, y: 0 }, handleOut: { x: -44.18, y: 0 } },
  { pos: { x: -85.8, y: -0.41 }, handleIn: { x: -52.48, y: -1.13 }, handleOut: { x: 46.62, y: 1.42 } },
]

// Mirror across x for leftward motion (negate x of every coord).
const PEAK_LEFT: [Anchor, Anchor, Anchor, Anchor] = PEAK_RIGHT.map(a => ({
  pos: { x: -a.pos.x, y: a.pos.y },
  // Mirroring also swaps handleIn/handleOut so the path traversal direction flips back to CW.
  handleIn: { x: -a.handleOut.x, y: a.handleOut.y },
  handleOut: { x: -a.handleIn.x, y: a.handleIn.y },
})) as [Anchor, Anchor, Anchor, Anchor]

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }
function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }
}
function lerpAnchor(a: Anchor, b: Anchor, t: number): Anchor {
  return {
    pos: lerpPt(a.pos, b.pos, t),
    handleIn: lerpPt(a.handleIn, b.handleIn, t),
    handleOut: lerpPt(a.handleOut, b.handleOut, t),
  }
}

function buildPath(anchors: Anchor[], scale: number): string {
  const s = (n: number) => n * scale
  const segs: string[] = []
  for (let i = 0; i < 4; i++) {
    const cur = anchors[i]
    const next = anchors[(i + 1) % 4]
    segs.push(
      `C ${s(cur.pos.x + cur.handleOut.x)} ${s(cur.pos.y + cur.handleOut.y)}, ` +
      `${s(next.pos.x + next.handleIn.x)} ${s(next.pos.y + next.handleIn.y)}, ` +
      `${s(next.pos.x)} ${s(next.pos.y)}`,
    )
  }
  return `M ${s(anchors[0].pos.x)} ${s(anchors[0].pos.y)} ${segs.join(' ')} Z`
}

interface Props {
  fabRef: RefObject<HTMLElement | null>
  /** FAB radius in CSS pixels — used to scale anchor coords from NORM_R=80 to actual size. */
  radius?: number
  /** Velocity (px/frame) at which deformation reaches peak. */
  peakVelocity?: number
}

export function FabBlob({ fabRef, radius = 32, peakVelocity = 6 }: Props) {
  const pathRef = useRef<SVGPathElement>(null)
  const stateRef = useRef({
    prevX: 0,
    velocity: 0,
    deform: 0,
    direction: 1, // +1 right, -1 left
    initialised: false,
    raf: 0,
  })

  useEffect(() => {
    const fab = fabRef.current
    const path = pathRef.current
    if (!fab || !path) return
    const st = stateRef.current
    const scale = radius / NORM_R

    const tick = () => {
      const rect = fab.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      let v = 0
      if (st.initialised) {
        v = cx - st.prevX
      }
      st.prevX = cx
      st.initialised = true

      // Smoothed velocity: low-pass filter so single-frame jitter doesn't shake the blob.
      st.velocity = st.velocity * 0.7 + v * 0.3

      const targetDeform = Math.min(1, Math.abs(st.velocity) / peakVelocity)
      // Asymmetric ease: snap into deform during motion, ease back when settling.
      const easeIn = 0.35
      const easeOut = 0.18
      const k = targetDeform > st.deform ? easeIn : easeOut
      st.deform += (targetDeform - st.deform) * k

      // Direction lock: only flip when velocity exceeds a small threshold.
      if (Math.abs(st.velocity) > 0.1) {
        st.direction = st.velocity > 0 ? 1 : -1
      }

      const peak = st.direction > 0 ? PEAK_RIGHT : PEAK_LEFT
      const blob: Anchor[] = REST.map((r, i) => lerpAnchor(r, peak[i], st.deform))
      path.setAttribute('d', buildPath(blob, scale))

      st.raf = requestAnimationFrame(tick)
    }

    st.raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(st.raf)
  }, [fabRef, radius, peakVelocity])

  // viewBox padded so deformed path doesn't clip. NORM_R=80, peak extends ~90 → use 128.
  return (
    <svg
      className="fab-blob"
      viewBox="-128 -128 256 256"
      aria-hidden="true"
    >
      <path ref={pathRef} d={buildPath(REST, radius / NORM_R)} fill="var(--accent)" />
    </svg>
  )
}
