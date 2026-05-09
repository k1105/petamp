import { useEffect, useMemo, useRef, useState } from 'react'

const VIEW = 64
const EYE_LEFT_X = 22
const EYE_RIGHT_X = 42
const EYE_Y = 32
const SCLERA_RX = 8
const SCLERA_RY = 11
const PUPIL_R = 6
const MAX_OFFSET = 4
const SATURATE_DIST = 60

interface Offset {
  x: number
  y: number
}

function computeOffset(svgRect: DOMRect, eyeX: number, eyeY: number, target: { x: number; y: number }): Offset {
  const scaleX = svgRect.width / VIEW
  const scaleY = svgRect.height / VIEW
  const screenX = svgRect.left + eyeX * scaleX
  const screenY = svgRect.top + eyeY * scaleY
  const dx = target.x - screenX
  const dy = target.y - screenY
  const dist = Math.hypot(dx, dy)
  if (dist === 0) return { x: 0, y: 0 }
  const factor = Math.min(1, dist / SATURATE_DIST)
  return {
    x: (dx / dist) * MAX_OFFSET * factor,
    y: (dy / dist) * MAX_OFFSET * factor,
  }
}

export function EyesIcon() {
  const svgRef = useRef<SVGSVGElement>(null)
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      setTarget({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('pointermove', onPointer)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('pointermove', onPointer)
    }
  }, [])

  const offsets = useMemo<[Offset, Offset]>(() => {
    if (!svgRef.current || !target) return [{ x: 0, y: 0 }, { x: 0, y: 0 }]
    const rect = svgRef.current.getBoundingClientRect()
    return [
      computeOffset(rect, EYE_LEFT_X, EYE_Y, target),
      computeOffset(rect, EYE_RIGHT_X, EYE_Y, target),
    ]
  }, [target])

  const pupilStyle = (off: Offset): React.CSSProperties => ({
    transform: `translate(${off.x}px, ${off.y}px)`,
    transition: 'transform 0.18s ease-out',
  })

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      width="100%"
      height="100%"
      aria-hidden="true"
    >
      <ellipse cx={EYE_LEFT_X} cy={EYE_Y} rx={SCLERA_RX} ry={SCLERA_RY} fill="#ffffff" />
      <ellipse cx={EYE_RIGHT_X} cy={EYE_Y} rx={SCLERA_RX} ry={SCLERA_RY} fill="#ffffff" />
      <circle
        cx={EYE_LEFT_X}
        cy={EYE_Y}
        r={PUPIL_R}
        fill="#0a0a0a"
        style={pupilStyle(offsets[0])}
      />
      <circle
        cx={EYE_RIGHT_X}
        cy={EYE_Y}
        r={PUPIL_R}
        fill="#0a0a0a"
        style={pupilStyle(offsets[1])}
      />
    </svg>
  )
}
