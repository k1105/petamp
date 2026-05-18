import { useEffect, useId, useMemo, useRef, useState } from 'react'
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

export function EyesIcon({ forceBlink = false }: { forceBlink?: boolean } = {}) {
  const ui = useSettingsStore(s => s.ui)
  const svgRef = useRef<SVGSVGElement>(null)
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null)
  const [blink, setBlink] = useState(false)
  const closed = forceBlink || blink

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

  // 3〜7秒ごとにまばたき。たまに二連まばたきも入れる。
  useEffect(() => {
    let stopped = false
    const timers: number[] = []

    const blinkOnce = (after: () => void) => {
      setBlink(true)
      timers.push(window.setTimeout(() => {
        if (stopped) return
        setBlink(false)
        timers.push(window.setTimeout(() => {
          if (stopped) return
          after()
        }, 90))
      }, 120))
    }

    const scheduleNext = () => {
      const delay = 3000 + Math.random() * 4000
      timers.push(window.setTimeout(() => {
        if (stopped) return
        const doubleBlink = Math.random() < 0.2
        blinkOnce(() => {
          if (stopped) return
          if (doubleBlink) blinkOnce(scheduleNext)
          else scheduleNext()
        })
      }, delay))
    }

    scheduleNext()
    return () => {
      stopped = true
      timers.forEach(t => window.clearTimeout(t))
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

  // 上まぶたが降りるように、clipPathの矩形を上から下へ閉じていく。
  // 目自体は変形させず、見える範囲だけが変わる。
  const uid = useId()
  const clipIdL = `eyelid-l-${uid}`
  const clipIdR = `eyelid-r-${uid}`
  const lidTopOpen = eyeY - scleraRy
  const lidHeightOpen = scleraRy * 2
  const lidTopClosed = eyeY + scleraRy
  const lidHeightClosed = 0
  const lidRectStyle: React.CSSProperties = {
    transition: 'y 0.09s ease-in-out, height 0.09s ease-in-out',
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      width="100%"
      height="100%"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipIdL} clipPathUnits="userSpaceOnUse">
          <rect
            x={EYE_LEFT_X - scleraRx}
            y={closed ? lidTopClosed : lidTopOpen}
            width={scleraRx * 2}
            height={closed ? lidHeightClosed : lidHeightOpen}
            style={lidRectStyle}
          />
        </clipPath>
        <clipPath id={clipIdR} clipPathUnits="userSpaceOnUse">
          <rect
            x={EYE_RIGHT_X - scleraRx}
            y={closed ? lidTopClosed : lidTopOpen}
            width={scleraRx * 2}
            height={closed ? lidHeightClosed : lidHeightOpen}
            style={lidRectStyle}
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipIdL})`}>
        <ellipse cx={EYE_LEFT_X} cy={eyeY} rx={scleraRx} ry={scleraRy} fill="#ffffff" />
        <circle
          cx={EYE_LEFT_X}
          cy={eyeY}
          r={pupilR}
          fill="#0a0a0a"
          style={pupilStyle(offsets[0])}
        />
      </g>
      <g clipPath={`url(#${clipIdR})`}>
        <ellipse cx={EYE_RIGHT_X} cy={eyeY} rx={scleraRx} ry={scleraRy} fill="#ffffff" />
        <circle
          cx={EYE_RIGHT_X}
          cy={eyeY}
          r={pupilR}
          fill="#0a0a0a"
          style={pupilStyle(offsets[1])}
        />
      </g>
    </svg>
  )
}
