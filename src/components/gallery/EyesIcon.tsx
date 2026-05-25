import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { EyeParams, NavState } from '../../store/useSettingsStore'
import { useEyeParams } from '../../hooks/useEyeParams'

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

interface EyesIconProps {
  blinkSignal?: number
  /** 指定すると useEyeParams で nav 状態に応じた値を補間して使う。 */
  navState?: NavState
  /** props 経由で直接 EyeParams を渡したい時用 (shape-editor のプレビュー用)。 */
  params?: EyeParams
}

export function EyesIcon({ blinkSignal, navState, params }: EyesIconProps = {}) {
  // 優先順位: props.params > navState (補間) > 'map' (補間) — 後方互換用 default。
  const interpolated = useEyeParams(navState ?? 'map')
  const eye: EyeParams = params ?? interpolated
  const svgRef = useRef<SVGSVGElement>(null)
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null)
  const [blink, setBlink] = useState(false)

  // blinkSignal が変わるたびに 1 回まばたき。値変化のみが起動条件で、初回マウント
  // (signal が定義されているがまだ何も起きていない) では発火しないよう、前回値を
  // ref で記憶しておく。
  const lastSignalRef = useRef(blinkSignal)
  useEffect(() => {
    if (blinkSignal === undefined) return
    if (blinkSignal === lastSignalRef.current) return
    lastSignalRef.current = blinkSignal
    setBlink(true)
    const t = window.setTimeout(() => setBlink(false), 120)
    return () => window.clearTimeout(t)
  }, [blinkSignal])

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

  const eyeY = EYE_Y_BASE + eye.eyeYOffset
  // eyeXOffset は両目を同方向に平行移動 (-側で左, +側で右)。
  const eyeLeftX = EYE_LEFT_X + eye.eyeXOffset
  const eyeRightX = EYE_RIGHT_X + eye.eyeXOffset
  const scleraRx = SCLERA_RX_BASE * eye.eyeSizeScale
  const scleraRy = SCLERA_RY_BASE * eye.eyeSizeScale
  const pupilR = PUPIL_R_BASE * eye.pupilSizeScale
  // 瞳が白目から飛び出さない最大移動量
  const maxOffset = Math.max(0, scleraRx - pupilR - 0.5)

  const offsets = useMemo<[Offset, Offset]>(() => {
    // SVG の bounding rect を測定するためにマウント済みノードを参照する。
    // 視線オフセット計算用で、target が変わったタイミングだけ再評価される。
    // eslint-disable-next-line react-hooks/refs
    if (!svgRef.current || !target) return [{ x: 0, y: 0 }, { x: 0, y: 0 }]
    // eslint-disable-next-line react-hooks/refs
    const rect = svgRef.current.getBoundingClientRect()
    return [
      computeOffset(rect, eyeLeftX, eyeY, target, maxOffset),
      computeOffset(rect, eyeRightX, eyeY, target, maxOffset),
    ]
  }, [target, eyeY, eyeLeftX, eyeRightX, maxOffset])

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
            x={eyeLeftX - scleraRx}
            y={blink ? lidTopClosed : lidTopOpen}
            width={scleraRx * 2}
            height={blink ? lidHeightClosed : lidHeightOpen}
            style={lidRectStyle}
          />
        </clipPath>
        <clipPath id={clipIdR} clipPathUnits="userSpaceOnUse">
          <rect
            x={eyeRightX - scleraRx}
            y={blink ? lidTopClosed : lidTopOpen}
            width={scleraRx * 2}
            height={blink ? lidHeightClosed : lidHeightOpen}
            style={lidRectStyle}
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipIdL})`}>
        <ellipse cx={eyeLeftX} cy={eyeY} rx={scleraRx} ry={scleraRy} fill="#ffffff" />
        <circle
          cx={eyeLeftX}
          cy={eyeY}
          r={pupilR}
          fill="#0a0a0a"
          style={pupilStyle(offsets[0])}
        />
      </g>
      <g clipPath={`url(#${clipIdR})`}>
        <ellipse cx={eyeRightX} cy={eyeY} rx={scleraRx} ry={scleraRy} fill="#ffffff" />
        <circle
          cx={eyeRightX}
          cy={eyeY}
          r={pupilR}
          fill="#0a0a0a"
          style={pupilStyle(offsets[1])}
        />
      </g>
    </svg>
  )
}
