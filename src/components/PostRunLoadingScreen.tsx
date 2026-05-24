import { useEffect } from 'react'
import { usePostRunLoadingStore } from '../store/usePostRunLoadingStore'
import { EyesIcon } from './gallery/EyesIcon'

const ENTER_DURATION_MS = 400
const CLOSE_DURATION_MS = 1000

export function PostRunLoadingScreen() {
  const phase = usePostRunLoadingStore(s => s.phase)
  const origin = usePostRunLoadingStore(s => s.origin)
  const setPhase = usePostRunLoadingStore(s => s.setPhase)
  const reset = usePostRunLoadingStore(s => s.reset)

  useEffect(() => {
    if (phase === 'idle') return
    // loading は対話側からの setReady() を待つだけなのでタイマー不要。
    if (phase === 'loading') return
    const dur = phase === 'entering' ? ENTER_DURATION_MS : CLOSE_DURATION_MS
    const t = window.setTimeout(() => {
      if (phase === 'entering') {
        // entering 中に setReady() が来ていたら loading をスキップして closing へ。
        const { readyPending } = usePostRunLoadingStore.getState()
        setPhase(readyPending ? 'closing' : 'loading')
      } else if (phase === 'closing') {
        reset()
      }
    }, dur)
    return () => window.clearTimeout(t)
  }, [phase, setPhase, reset])

  if (phase === 'idle') return null

  const style = origin
    ? ({
        '--origin-x': `${origin.x}px`,
        '--origin-y': `${origin.y}px`,
      } as React.CSSProperties)
    : undefined

  return (
    <div
      className={`post-run-loading phase-${phase}`}
      style={style}
      aria-hidden={phase !== 'loading'}
    >
      <div className="post-run-loading-inner">
        <div className="post-run-loading-eyes">
          <EyesIcon />
        </div>
        <div className="post-run-loading-text">loading...</div>
      </div>
    </div>
  )
}
