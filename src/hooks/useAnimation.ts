import { useRef, useCallback } from 'react'
import { useReplayStore } from '../store/useReplayStore'
import { REPLAY_SPEED } from '../utils/replaySpeed'

export function useAnimation() {
  const { currentTime, isPlaying, duration, setCurrentTime, setIsPlaying, setDuration } = useReplayStore()
  const rafRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    lastFrameTimeRef.current = null
    setIsPlaying(false)
  }, [setIsPlaying])

  const play = useCallback(() => {
    setIsPlaying(true)
    const tick = (now: number) => {
      if (lastFrameTimeRef.current === null) {
        lastFrameTimeRef.current = now
      }
      // ラン終了後のループ再生 (RunResultPage) と同じ速さで動点を進める
      const delta = ((now - lastFrameTimeRef.current) / 1000) * REPLAY_SPEED
      lastFrameTimeRef.current = now

      const store = useReplayStore.getState()
      const next = store.currentTime + delta
      // 末尾に到達したら先頭へ巻き戻してシームレスに無限ループ (明示停止まで止めない)。
      setCurrentTime(duration > 0 ? next % duration : next)

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [duration, setCurrentTime, setIsPlaying, stop])

  const seekTo = useCallback((seconds: number) => {
    setCurrentTime(Math.max(0, Math.min(seconds, duration)))
  }, [duration, setCurrentTime])

  const reset = useCallback(() => {
    stop()
    setCurrentTime(0)
  }, [stop, setCurrentTime])

  return { currentTime, isPlaying, duration, setDuration, play, stop, seekTo, reset }
}
