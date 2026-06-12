import { useCallback, useEffect, useRef, useState } from 'react'
import { useReplayStore } from '../store/useReplayStore'

export interface ReplayTapFlash {
  icon: 'play' | 'pause'
  /** アニメーション再生用の更新キー (タップごとに増える)。 */
  n: number
}

/**
 * 画面中央タップでリプレイの再生/停止を切り替える。
 * ドラッグ (地図オービット) や長押し、ignoreSelector にマッチする要素上の
 * タップはトグル対象外。戻り値は画面中央に一瞬出す再生/停止アイコンの状態。
 */
export function useReplayTapToggle(
  play: () => void,
  stop: () => void,
  reset: () => void,
  ignoreSelector: string,
): ReplayTapFlash | null {
  const [tapFlash, setTapFlash] = useState<ReplayTapFlash | null>(null)
  const tapFlashNRef = useRef(0)
  const tapFlashTimerRef = useRef<number | null>(null)

  // 画面中央に再生/停止アイコンを一瞬表示する
  const showTapFlash = useCallback((icon: 'play' | 'pause') => {
    tapFlashNRef.current += 1
    setTapFlash({ icon, n: tapFlashNRef.current })
    if (tapFlashTimerRef.current !== null) window.clearTimeout(tapFlashTimerRef.current)
    tapFlashTimerRef.current = window.setTimeout(() => setTapFlash(null), 600)
  }, [])

  // 再生/停止トグル。最新状態は store から直接読む（毎フレームの再subscribeを避ける）
  const togglePlayback = useCallback(() => {
    const s = useReplayStore.getState()
    if (s.isPlaying) {
      stop()
      showTapFlash('pause')
    } else {
      if (s.duration > 0 && s.currentTime >= s.duration) reset()
      play()
      showTapFlash('play')
    }
  }, [play, stop, reset, showTapFlash])

  useEffect(() => {
    let start: { x: number; y: number; t: number } | null = null
    const onDown = (e: PointerEvent) => {
      start = { x: e.clientX, y: e.clientY, t: e.timeStamp }
    }
    const onUp = (e: PointerEvent) => {
      const s = start
      start = null
      if (!s) return
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) return
      if (e.timeStamp - s.t > 500) return
      const el = e.target as HTMLElement | null
      if (el?.closest(ignoreSelector)) return
      togglePlayback()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('pointerup', onUp)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('pointerup', onUp)
    }
  }, [togglePlayback, ignoreSelector])

  // アンマウント時に flash タイマーを後始末
  useEffect(() => () => {
    if (tapFlashTimerRef.current !== null) window.clearTimeout(tapFlashTimerRef.current)
  }, [])

  return tapFlash
}
