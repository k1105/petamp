import { useEffect, useMemo, useRef, useState } from 'react'
import { useSettingsStore } from '../../store/useSettingsStore'

const VIEW = 64
const EYE_LEFT_X = 22
const EYE_RIGHT_X = 42
const EYE_Y_BASE = 32
const SCLERA_RX_BASE = 8
const SCLERA_RY_BASE = 11
const PUPIL_R_BASE = 6
const SATURATE_DIST = 60

interface Offset {
  x: number
  y: number
}

function computeOffset(
  svgRect: DOMRect,
  eyeX: number,
  eyeY: number,
  target: { x: number; y: number },
  maxOffset: number,
): Offset {
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
    x: (dx / dist) * maxOffset * factor,
    y: (dy / dist) * maxOffset * factor,
  }
}

export function EyesIcon() {
  const ui = useSettingsStore(s => s.ui)
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

  const eyeY = EYE_Y_BASE + ui.eyeYOffset
  const scleraRx = SCLERA_RX_BASE * ui.eyeSizeScale
  const scleraRy = SCLERA_RY_BASE * ui.eyeSizeScale
  const pupilR = PUPIL_R_BASE * ui.pupilSizeScale
  // 瞳が白目から飛び出さない最大移動量
  const maxOffset = Math.max(0, scleraRx - pupilR - 0.5)

  const offsets = useMemo<[Offset, Offset]>(() => {
    if (!svgRef.current || !target) return [{ x: 0, y: 0 }, { x: 0, y: 0 }]
    const rect = svgRef.current.getBoundingClientRect()
    return [
      computeOffset(rect, EYE_LEFT_X, eyeY, target, maxOffset),
      computeOffset(rect, EYE_RIGHT_X, eyeY, target, maxOffset),
    ]
  }, [target, eyeY, maxOffset])

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
      <ellipse cx={EYE_LEFT_X} cy={eyeY} rx={scleraRx} ry={scleraRy} fill="#ffffff" />
      <ellipse cx={EYE_RIGHT_X} cy={eyeY} rx={scleraRx} ry={scleraRy} fill="#ffffff" />
      <circle
        cx={EYE_LEFT_X}
        cy={eyeY}
        r={pupilR}
        fill="#0a0a0a"
        style={pupilStyle(offsets[0])}
      />
      <circle
        cx={EYE_RIGHT_X}
        cy={eyeY}
        r={pupilR}
        fill="#0a0a0a"
        style={pupilStyle(offsets[1])}
      />
    </svg>
  )
}
