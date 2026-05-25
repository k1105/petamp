import { useEffect, useRef } from 'react'

interface JoystickHandlers {
  /** tap (= pointerdown→pointerup で閾値未満) のときに呼ばれる。
   *  (relX, relY) は button 中心からの相対座標 (px)。caller 側で中心円の
   *  ヒット判定をしたいケースに使う。 */
  onTap?: (relX: number, relY: number) => void
  onJoystickFrame?: (dx: number, dy: number) => void
  /** drag が終わった (pointerup / cancel で) 直後に 1 回だけ呼ばれる。
   *  ドラッグに連動して設定した追加 CSS 変数 (例: 目の位置) をリセットしたい
   *  ケース用。 */
  onDragEnd?: () => void
}

interface Options {
  maxRadius?: number
  tapThreshold?: number
}

const DEFAULT_MAX_RADIUS = 60
const DEFAULT_TAP_THRESHOLD = 6

// ボタンを掴んで方向にずらすとジョイスティック化するフック。
// 閾値未満で離せばタップ扱い、超えたらドラッグ中は毎フレーム onJoystickFrame に
// クランプ後の (dx, dy) を渡す。離すとボタン視覚オフセットは 0 に戻る。
export function useJoystickButton(
  ref: React.RefObject<HTMLElement | null>,
  handlers: JoystickHandlers,
  options?: Options,
) {
  const handlersRef = useRef(handlers)
  // pointer ハンドラから常に最新コールバックを呼ぶための ref 同期。
  // eslint-disable-next-line react-hooks/refs
  handlersRef.current = handlers
  const maxRadius = options?.maxRadius ?? DEFAULT_MAX_RADIUS
  const tapThreshold = options?.tapThreshold ?? DEFAULT_TAP_THRESHOLD

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let activeId: number | null = null
    let startX = 0
    let startY = 0
    let curDx = 0
    let curDy = 0
    let moved = false
    let raf = 0

    const setOffset = (dx: number, dy: number) => {
      const len = Math.hypot(dx, dy)
      if (len > maxRadius) {
        const k = maxRadius / len
        dx *= k
        dy *= k
      }
      curDx = dx
      curDy = dy
      el.style.setProperty('--jx', `${dx}px`)
      el.style.setProperty('--jy', `${dy}px`)
    }

    const tick = () => {
      handlersRef.current.onJoystickFrame?.(curDx, curDy)
      raf = requestAnimationFrame(tick)
    }

    const endDrag = () => {
      const wasJoysticking = el.classList.contains('is-joysticking')
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
      el.classList.remove('is-joysticking')
      el.style.setProperty('--jx', '0px')
      el.style.setProperty('--jy', '0px')
      curDx = 0
      curDy = 0
      if (wasJoysticking) handlersRef.current.onDragEnd?.()
    }

    const onPointerDown = (e: PointerEvent) => {
      if (activeId !== null) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      activeId = e.pointerId
      startX = e.clientX
      startY = e.clientY
      curDx = 0
      curDy = 0
      moved = false
      el.setPointerCapture(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (activeId !== e.pointerId) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (!moved) {
        if (Math.hypot(dx, dy) <= tapThreshold) return
        moved = true
        el.classList.add('is-joysticking')
        setOffset(dx, dy)
        raf = requestAnimationFrame(tick)
      } else {
        setOffset(dx, dy)
      }
    }
    const onPointerUp = (e: PointerEvent) => {
      if (activeId !== e.pointerId) return
      activeId = null
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      const wasTap = !moved
      endDrag()
      if (wasTap) {
        const rect = el.getBoundingClientRect()
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        handlersRef.current.onTap?.(startX - cx, startY - cy)
      }
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [ref, maxRadius, tapThreshold])
}
